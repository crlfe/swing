package main

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"syscall"
	"unicode"
)

//go:embed LICENSE.txt
var licenseText string

// --- Constants ---

const maxFileSize = 1 * 1024 * 1024 // 1MB limit for reading/grepping files

// maxReadBytes caps the content returned by read_file / read_block before
// truncation. The budget is in bytes rather than lines because token cost
// tracks bytes, not lines: a 300KB single-line minified file is unusable no
// matter how few lines it has, while 2000 short lines are cheap.
const maxReadBytes = 32 * 1024

// grep_files limits: cap matches per file and overall to avoid flooding context.
// maxGrepLineBytes caps each matched line too: a minified file is a single
// huge line, so counting matches alone is not enough to bound the result.
const maxGrepMatchesPerFile = 10
const maxGrepMatchesTotal = 50
const maxGrepLineBytes = 500

// maxFindResults caps find_files output: a broad pattern over a large tree
// would otherwise flood the transcript with paths.
const maxFindResults = 200

// maxWalkErrors caps how many filepath.WalkDir errors are printed before the
// remainder are summarized in a single suppressed-count line.
const maxWalkErrors = 4

// printMode identifies the kind of streaming output being rendered.
type printMode int

const (
	modeNone      printMode = iota // no output yet
	modeReasoning                  // reasoning text (dimmed)
	modeContent                    // content text (plain)
)

// --- OpenAI API Types ---

type Message struct {
	Role             string     `json:"role"`
	Content          string     `json:"content"`
	Reasoning        string     `json:"reasoning,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"`
	ToolCallID       string     `json:"tool_call_id,omitempty"`
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
}

type ToolCall struct {
	Index    *int             `json:"index,omitempty"`
	ID       string           `json:"id,omitempty"`
	Type     string           `json:"type,omitempty"`
	Function ToolCallFunction `json:"function"`
}

type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type Tool struct {
	Type     string      `json:"type"`
	Function FunctionDef `json:"function"`
}

type FunctionDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
}

type ChatRequest struct {
	Model           string    `json:"model"`
	Messages        []Message `json:"messages"`
	Tools           []Tool    `json:"tools,omitempty"`
	Stream          bool      `json:"stream"`
	ReasoningEffort string    `json:"reasoning_effort,omitempty"`
}

type ChatResponse struct {
	Choices []struct {
		Message Message `json:"message"`
	} `json:"choices"`
	Usage *Usage `json:"usage,omitempty"`
}

type ChatStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content          string     `json:"content"`
			Reasoning        string     `json:"reasoning"`
			ReasoningContent string     `json:"reasoning_content"`
			ToolCalls        []ToolCall `json:"tool_calls"`
		} `json:"delta"`
	} `json:"choices"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// --- Tool System ---

type JSObject map[string]any
type ToolHandler func(argsJSON string) (string, error)

type ToolRegistration struct {
	Name        string
	Description string
	Parameters  JSObject
	IsWrite     bool
	Handler     ToolHandler
}

var toolList = []ToolRegistration{
	{
		Name:        "read_file",
		Description: "Read file contents",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		IsWrite: false,
		Handler: handleReadFile,
	},
	{
		Name:        "read_block",
		Description: "Read a specific function or block of code. Use this to inspect a small part of a file before editing it. It finds the first line containing the query and reads all subsequent lines that are more deeply indented, stopping before the line where indentation returns to the starting level. Optional: start_line and end_line to constrain search.",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":       JSObject{"type": "string"},
				"query":      JSObject{"type": "string"},
				"start_line": JSObject{"type": "integer", "description": "1-based start line for search"},
				"end_line":   JSObject{"type": "integer", "description": "1-based end line for search"},
			},
			"required": []string{"path", "query"},
		},
		IsWrite: false,
		Handler: handleReadBlock,
	},
	{
		Name:        "list_dir",
		Description: "List directory files",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		IsWrite: false,
		Handler: handleListDir,
	},
	{
		Name:        "find_files",
		Description: "Search for files whose names match a glob pattern",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":    JSObject{"type": "string", "description": "Root directory to start search"},
				"pattern": JSObject{"type": "string", "description": "Glob pattern (e.g. *.go)"},
			},
			"required": []string{"path", "pattern"},
		},
		IsWrite: false,
		Handler: handleFindFiles,
	},
	{
		Name:        "grep_files",
		Description: "Search for files containing a specified string",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":  JSObject{"type": "string", "description": "Root directory to start search"},
				"query": JSObject{"type": "string", "description": "String to search for in file contents"},
			},
			"required": []string{"path", "query"},
		},
		IsWrite: false,
		Handler: handleGrepFiles,
	},
	{
		Name:        "write_block",
		Description: "Surgically replace a specific block of text in a file. This is the preferred way to edit existing files. You must provide the exact text of the block to be replaced (oldBlock) and the new text (newBlock). Optional: start_line and end_line to constrain search.",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":       JSObject{"type": "string"},
				"oldBlock":   JSObject{"type": "string", "description": "The exact text to be replaced"},
				"newBlock":   JSObject{"type": "string", "description": "The replacement text"},
				"start_line": JSObject{"type": "integer", "description": "1-based start line for search"},
				"end_line":   JSObject{"type": "integer", "description": "1-based end line for search"},
			},
			"required": []string{"path", "oldBlock", "newBlock"},
		},
		IsWrite: true,
		Handler: handleWriteBlock,
	},
	{
		Name:        "write_file",
		Description: "Create a new file or completely overwrite an existing one. Use this only for new files or total rewrites.",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":    JSObject{"type": "string"},
				"content": JSObject{"type": "string"},
			},
			"required": []string{"path", "content"},
		},
		IsWrite: true,
		Handler: handleWriteFile,
	},
	{
		Name:        "create_dir",
		Description: "Create a new directory",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		IsWrite: true,
		Handler: handleCreateDir,
	},
	{
		Name:        "delete_file",
		Description: "Delete a file (errors if the path is a directory)",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		IsWrite: true,
		Handler: handleDeleteFile,
	},
	{
		Name:        "delete_dir",
		Description: "Delete an empty directory (errors if not empty)",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		IsWrite: true,
		Handler: handleDeleteDir,
	},
}

var toolRegistry map[string]ToolRegistration

func init() {
	toolRegistry = make(map[string]ToolRegistration, len(toolList))
	for _, reg := range toolList {
		if _, exists := toolRegistry[reg.Name]; exists {
			panic("duplicate tool name: " + reg.Name)
		}
		toolRegistry[reg.Name] = reg
	}
}

// --- Tool Argument Types ---

type WriteFileArgs struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type WriteBlockArgs struct {
	Path      string `json:"path"`
	OldBlock  string `json:"oldBlock"`
	NewBlock  string `json:"newBlock"`
	StartLine int    `json:"start_line,omitempty"`
	EndLine   int    `json:"end_line,omitempty"`
}

type FindFilesArgs struct {
	Path    string `json:"path"`
	Pattern string `json:"pattern"`
}

type GrepFilesArgs struct {
	Path  string `json:"path"`
	Query string `json:"query"`
}

type ReadBlockArgs struct {
	Path      string `json:"path"`
	Query     string `json:"query"`
	StartLine int    `json:"start_line,omitempty"`
	EndLine   int    `json:"end_line,omitempty"`
}

type PathArgs struct {
	Path string `json:"path"`
}

type Config struct {
	BaseURL         string
	APIKey          string
	Model           string
	ReasoningEffort string
}

var httpClient = &http.Client{
	Timeout: 0,
}

func sanitizeForTerminal(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsPrint(r) || r == '\n' || r == '\t' || r == '\r' {
			return r
		}
		return -1
	}, s)
}

func getRangeString(startLine, endLine int) string {
	if startLine <= 0 && endLine <= 0 {
		return ""
	}
	if startLine > 0 && endLine == 0 {
		return fmt.Sprintf(" (lines %d-end)", startLine)
	} else if startLine == 0 && endLine > 0 {
		return fmt.Sprintf(" (lines start-%d)", endLine)
	}
	return fmt.Sprintf(" (lines %d-%d)", startLine, endLine)
}

// --- Text File Line Access Helper ---

// textFile provides line-based access to a text file using only a byte-offset
// table, so callers can move between 1-based line numbers and byte positions
// in the raw content without materializing a separate slice of line strings.
//
// Line splitting follows the convention used throughout this file: lines are
// delimited by a single '\n'. A file ending in a newline therefore yields a
// final empty line, and total() includes it. This matches strings.Split(content,
// "\n") and preserves the line-counting behavior of read_file / read_block /
// write_block.
//
// Note: '\r\n' (Windows) line endings are intentionally treated as part of the
// line text rather than as a line terminator; only '\n' splits lines.
type textFile struct {
	content string
	// offsets[i] is the byte index in content where line i (0-based) begins.
	// len(offsets) is the number of lines.
	offsets []int
}

// readTextFile reads a whole file (guarded by maxFileSize) and builds the
// offset table.
func readTextFile(path string) (*textFile, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxFileSize {
		return nil, fmt.Errorf("file is too large to process (%d bytes, max %d)", info.Size(), maxFileSize)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return newTextFile(string(b)), nil
}

// newTextFile builds the offset table from raw content. The offsets produced
// are equivalent to the boundaries implied by strings.Split(content, "\n").
func newTextFile(content string) *textFile {
	var offsets []int
	off := 0
	for {
		offsets = append(offsets, off)
		idx := strings.IndexByte(content[off:], '\n')
		if idx < 0 {
			break
		}
		off += idx + 1 // skip past the newline to the start of the next line
	}
	return &textFile{content: content, offsets: offsets}
}

// total returns the number of lines (matching the existing len(lines) count).
func (t *textFile) total() int { return len(t.offsets) }

// line returns the text of the 1-based line n, with its trailing newline
// stripped. Out-of-range n returns "". slice(n, n) already handles the last
// line, since endOffset returns len(content) there and there is no newline to
// strip.
func (t *textFile) line(n int) string {
	if n < 1 || n > t.total() {
		return ""
	}
	return strings.TrimSuffix(t.slice(n, n), "\n")
}

// normalizeRange turns the tool-facing (start, end) pair — where 0 means
// "unset" — into concrete 1-based inclusive bounds clamped to the file.
func (t *textFile) normalizeRange(start, end int) (int, int, error) {
	if start < 0 || end < 0 {
		return 0, 0, fmt.Errorf("start_line and end_line must be positive")
	}
	if start == 0 {
		start = 1
	}
	if end == 0 || end > t.total() {
		end = t.total()
	}
	if start > t.total() {
		return 0, 0, fmt.Errorf("start_line %d is beyond file length %d", start, t.total())
	}
	if end < start {
		return 0, 0, fmt.Errorf("end_line cannot be less than start_line")
	}
	return start, end, nil
}

// slice returns the text of lines [start..end] (1-based, inclusive) as a
// single subslice of the raw content. Because endOffset(end) sits just past
// line end's newline, this reproduces the same text strings.Join would produce
// without re-inserting newlines.
func (t *textFile) slice(start, end int) string {
	return t.content[t.startOffset(start):t.endOffset(end)]
}

// startOffset returns the byte index where 1-based line n begins.
func (t *textFile) startOffset(n int) int {
	if n <= 1 {
		return 0
	}
	return t.offsets[n-1]
}

// endOffset returns the byte index just past the end of 1-based line n
// (i.e. the start of line n+1, or len(content) if n is the last line).
func (t *textFile) endOffset(n int) int {
	if n >= t.total() {
		return len(t.content)
	}
	return t.offsets[n]
}

// lineAt returns the 1-based line number that contains the byte offset off.
// offsets is sorted, so this is a binary search for the last line whose start
// offset is <= off. The newline that terminates a line belongs to that line,
// so an offset landing on a newline resolves to the line it ends.
func (t *textFile) lineAt(off int) int {
	idx, found := slices.BinarySearch(t.offsets, off)
	if !found {
		idx--
	}
	return idx + 1
}

// fitRange returns the largest end line e within [start..end] such that the
// text of lines [start..e] fits within maxBytes. endOffset is monotonic in n,
// so this is a binary search. It returns start when line start alone exceeds
// maxBytes; callers must handle that case by cutting mid-line.
func (t *textFile) fitRange(start, end, maxBytes int) int {
	lo, hi := start, end
	for lo < hi {
		mid := (lo + hi + 1) / 2
		if t.endOffset(mid)-t.startOffset(start) <= maxBytes {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return lo
}

// matchLinesFor locates search within lines [startLine..endLine] and returns
// the parsed file together with the 1-based, inclusive range of COMPLETE lines
// that the match spans. Callers use the returned textFile and line range to
// slice the file on line boundaries (via startOffset/endOffset), so both reads
// and edits always operate on whole lines and the file is parsed exactly once.
func matchLinesFor(path string, search string, startLine, endLine int) (tf *textFile, matchStart, matchEnd int, err error) {
	// An empty search would match at offset 0 everywhere, and the duplicate
	// check below would slice past the end of an empty search area. Neither
	// caller has a meaningful use for it.
	if search == "" {
		return nil, 0, 0, fmt.Errorf("the search string may not be empty")
	}

	tf, err = readTextFile(path)
	if err != nil {
		return nil, 0, 0, err
	}
	sContent := tf.content

	// Turn the tool-facing (start, end) pair into concrete 1-based bounds and
	// convert them to byte offsets delimiting the search area.
	start, end, err := tf.normalizeRange(startLine, endLine)
	if err != nil {
		return nil, 0, 0, err
	}
	searchStart := tf.startOffset(start)
	searchEnd := tf.endOffset(end)

	searchArea := sContent[searchStart:searchEnd]
	idx := strings.Index(searchArea, search)
	if idx == -1 {
		return nil, 0, 0, fmt.Errorf("search string not found in file (within lines %d-%d)", start, end)
	}

	if strings.Contains(searchArea[idx+1:], search) {
		return nil, 0, 0, fmt.Errorf("search string found multiple times in search area")
	}

	// Expand the raw byte match to the complete lines it touches: the line
	// holding its first byte through the line holding its last byte.
	absIdx := searchStart + idx
	matchStart = tf.lineAt(absIdx)
	matchEnd = tf.lineAt(absIdx + len(search) - 1)
	return tf, matchStart, matchEnd, nil
}

func resolvePath(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("the 'path' argument may not be missing or empty")
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("could not get current working directory: %v", err)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("the 'path' argument is invalid: %v", err)
	}

	if realPath, err := filepath.EvalSymlinks(absPath); err == nil {
		absPath = realPath
	}

	rel, err := filepath.Rel(cwd, absPath)
	if err != nil || strings.HasPrefix(rel, "..") || strings.HasPrefix(rel, string(filepath.Separator)) {
		return "", fmt.Errorf("the 'path' argument is outside the working directory")
	}

	for comp := range strings.SplitSeq(rel, string(filepath.Separator)) {
		if comp != "" && comp != "." && strings.HasPrefix(comp, ".") {
			return "", fmt.Errorf("the 'path' argument includes a hidden file or directory; these are blocked for security reasons")
		}
	}

	return absPath, nil
}

func logToolCall(format string, args ...any) {
	fmt.Printf("\033[32m[Tool]\033[0m "+format+"\n", args...)
}

func unmarshalStrict(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func walkAndFilter(root string, filter func(path string, d os.DirEntry) (bool, error)) ([]string, error) {
	var matches []string
	var errorCount int

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			errorCount++
			if errorCount <= maxWalkErrors {
				fmt.Fprintf(os.Stderr, "\033[31m[Walk Error]\033[0m %s: %v\n", path, err)
			}
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if matched, err := filter(path, d); err == nil && matched {
			rel, _ := filepath.Rel(root, path)
			matches = append(matches, rel)
		}
		return nil
	})

	if errorCount > maxWalkErrors {
		fmt.Fprintf(os.Stderr, "\033[31m[Walk Error]\033[0m Suppressed %d additional errors\n", errorCount-maxWalkErrors)
	}

	return matches, err
}

func handleReadFile(argsJSON string) (string, error) {
	var args PathArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("read_file %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(safePath)
	if err != nil {
		return "", err
	}
	if info.Size() > maxFileSize {
		return "", fmt.Errorf("file is too large to read (%d bytes, max %d)", info.Size(), maxFileSize)
	}

	b, err := os.ReadFile(safePath)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// indentOf returns the width of a line's leading run of spaces and tabs.
func indentOf(line string) int {
	return len(line) - len(strings.TrimLeft(line, " \t"))
}

func handleReadBlock(argsJSON string) (string, error) {
	var args ReadBlockArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	firstLineOfQuery := newTextFile(args.Query).line(1)

	rangeStr := getRangeString(args.StartLine, args.EndLine)
	logToolCall("read_block %q find %q%s", args.Path, firstLineOfQuery, rangeStr)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	tf, matchStart, _, err := matchLinesFor(safePath, args.Query, args.StartLine, args.EndLine)
	if err != nil {
		return "", err
	}

	// Walk the file line by line from the matched line using the offset table
	// built once by matchLinesFor. Every line considered is a complete line,
	// so the block is whole lines and startIndent is measured from the start of
	// the matched line rather than from wherever the match happened to begin.
	// A blank line never ends a block: it is kept, and the scan continues to
	// the next non-blank line.
	var block []string
	var startIndent int

	for n := matchStart; n <= tf.total(); n++ {
		line := tf.line(n)
		if n == matchStart {
			block = append(block, line)
			startIndent = indentOf(line)
			continue
		}
		if strings.TrimSpace(line) != "" && indentOf(line) <= startIndent {
			break
		}
		block = append(block, line)
	}

	return strings.Join(block, "\n"), nil
}

func handleWriteBlock(argsJSON string) (string, error) {
	var args WriteBlockArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	firstLine := newTextFile(args.OldBlock).line(1)

	rangeStr := getRangeString(args.StartLine, args.EndLine)
	logToolCall("write_block %q replace %q%s", args.Path, firstLine, rangeStr)

	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	tf, matchStart, matchEnd, err := matchLinesFor(safePath, args.OldBlock, args.StartLine, args.EndLine)
	if err != nil {
		return "", err
	}

	// Replace the COMPLETE lines the match spans. startOffset(matchStart) sits
	// just before the first matched line and endOffset(matchEnd) just after the
	// last, so before/after land on line boundaries and the edit never splits a
	// line. If the replaced region was newline-terminated, make sure the
	// replacement is too, so the following line stays separated.
	newBlock := args.NewBlock
	if strings.HasSuffix(tf.slice(matchStart, matchEnd), "\n") && !strings.HasSuffix(newBlock, "\n") {
		newBlock += "\n"
	}
	newContent := tf.content[:tf.startOffset(matchStart)] + newBlock + tf.content[tf.endOffset(matchEnd):]
	err = os.WriteFile(safePath, []byte(newContent), 0644)
	if err != nil {
		return "", err
	}
	return "Success", nil
}

func handleWriteFile(argsJSON string) (string, error) {
	var args WriteFileArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("write_file %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	err = os.WriteFile(safePath, []byte(args.Content), 0644)
	if err != nil {
		return "", err
	}
	return "Success", nil
}

func handleListDir(argsJSON string) (string, error) {
	var args PathArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("list_dir %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(safePath)
	if err != nil {
		return "", err
	}
	var names []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		name := e.Name()
		if e.IsDir() {
			name += "/"
		}
		names = append(names, name)
	}
	return strings.Join(names, "\n"), nil
}

func handleFindFiles(argsJSON string) (string, error) {
	var args FindFilesArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("find_files %q pattern %q", args.Path, args.Pattern)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	matches, err := walkAndFilter(safePath, func(path string, d os.DirEntry) (bool, error) {
		return filepath.Match(args.Pattern, d.Name())
	})
	if err != nil {
		return "", err
	}
	return strings.Join(matches, "\n"), nil
}

func handleGrepFiles(argsJSON string) (string, error) {
	var args GrepFilesArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("grep_files %q query %q", args.Path, args.Query)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	matches, err := walkAndFilter(safePath, func(path string, d os.DirEntry) (bool, error) {
		info, err := d.Info()
		if err != nil {
			return false, err
		}
		if info.Size() > maxFileSize {
			return false, nil
		}

		f, err := os.Open(path)
		if err != nil {
			return false, err
		}
		defer f.Close()

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			if strings.Contains(scanner.Text(), args.Query) {
				return true, nil
			}
		}
		if err := scanner.Err(); err != nil {
			return false, err
		}

		return false, nil
	})
	if err != nil {
		return "", err
	}
	return strings.Join(matches, "\n"), nil
}

func handleDeleteFile(argsJSON string) (string, error) {
	var args PathArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("delete_file %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(safePath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("cannot delete directory using delete_file; use delete_dir instead")
	}

	if err := os.Remove(safePath); err != nil {
		return "", err
	}
	return "Success", nil
}

func handleCreateDir(argsJSON string) (string, error) {
	var args PathArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("create_dir %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(safePath, 0755); err != nil {
		return "", err
	}
	return "Success", nil
}

func handleDeleteDir(argsJSON string) (string, error) {
	var args PathArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	logToolCall("delete_dir %q", args.Path)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(safePath)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("cannot delete file using delete_dir; use delete_file instead")
	}

	if err := os.Remove(safePath); err != nil {
		return "", fmt.Errorf("failed to delete directory (it may not be empty): %v", err)
	}
	return "Success", nil
}

func hasGoCommand(prompt string) bool {
	re := regexp.MustCompile(`^/go(\s|$)|(^|\s)/go$`)
	return re.MatchString(prompt)
}

func executeTool(tc ToolCall, writesAllowed bool) (string, error) {
	reg, ok := toolRegistry[tc.Function.Name]
	if !ok {
		return "", fmt.Errorf("Unknown tool: %s", tc.Function.Name)
	}

	if reg.IsWrite && !writesAllowed {
		return "", fmt.Errorf("Permission Denied: The user must explicitly authorize write operations by including '/go' at the beginning or end of their prompt")
	}

	return reg.Handler(tc.Function.Arguments)
}

func getTools() []Tool {
	tools := make([]Tool, 0, len(toolList))
	for _, reg := range toolList {
		tools = append(tools, Tool{
			Type: "function",
			Function: FunctionDef{
				Name:        reg.Name,
				Description: reg.Description,
				Parameters:  reg.Parameters,
			},
		})
	}
	return tools
}

func callEndpointStreaming(ctx context.Context, cfg Config, messages []Message, tools []Tool, isFirstTurn bool) (Message, error) {
	reqBody := ChatRequest{
		Model:           cfg.Model,
		Messages:        messages,
		Tools:           tools,
		Stream:          true,
		ReasoningEffort: cfg.ReasoningEffort,
	}

	jsonReq, err := json.Marshal(reqBody)
	if err != nil {
		return Message{}, fmt.Errorf("failed to marshal request: %v", err)
	}

	fullUrl := strings.TrimSuffix(cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", fullUrl, bytes.NewBuffer(jsonReq))
	if err != nil {
		return Message{}, fmt.Errorf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	fmt.Print("\033[33mWaiting...\033[0m ")
	resp, err := httpClient.Do(req)
	fmt.Print("\r\033[K")
	if err != nil {
		return Message{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return Message{}, fmt.Errorf("API returned non-OK status %d: %s", resp.StatusCode, string(body))
	}

	var assistantMsg Message
	assistantMsg.Role = "assistant"

	toolCallsMap := make(map[int]*ToolCall)
	maxIdx := -1

	// Track the current output mode to add blank lines on transitions.
	// 0: none, 1: reasoning, 2: content
	lastMode := 0
	startedPrinting := false
	var lastChar rune

	printTransitionNewline := func() {
		if lastChar == '\n' {
			fmt.Print("\n")
		} else {
			fmt.Print("\n\n")
		}
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var chunk ChatStreamChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				continue
			}

			if len(chunk.Choices) == 0 {
				continue
			}

			delta := chunk.Choices[0].Delta

			// Handle Reasoning
			if delta.Reasoning != "" {
				if !isFirstTurn && !startedPrinting {
					fmt.Print("\n")
					startedPrinting = true
				}
				if lastMode == 2 {
					printTransitionNewline()
				}
				sanitized := sanitizeForTerminal(delta.Reasoning)
				fmt.Print("\033[38;5;244m" + sanitized + "\033[0m")
				assistantMsg.Reasoning += delta.Reasoning
				lastMode = 1
				if len(sanitized) > 0 {
					lastChar = rune(sanitized[len(sanitized)-1])
				}
			}

			// Handle ReasoningContent
			if delta.ReasoningContent != "" {
				if !isFirstTurn && !startedPrinting {
					fmt.Print("\n")
					startedPrinting = true
				}
				if lastMode == 2 {
					printTransitionNewline()
				}
				sanitized := sanitizeForTerminal(delta.ReasoningContent)
				fmt.Print("\033[38;5;244m" + sanitized + "\033[0m")
				assistantMsg.ReasoningContent += delta.ReasoningContent
				lastMode = 1
				if len(sanitized) > 0 {
					lastChar = rune(sanitized[len(sanitized)-1])
				}
			}

			if delta.Content != "" {
				if !isFirstTurn && !startedPrinting {
					fmt.Print("\n")
					startedPrinting = true
				}
				if lastMode == 1 {
					printTransitionNewline()
				}
				sanitized := sanitizeForTerminal(delta.Content)
				fmt.Print(sanitized)
				assistantMsg.Content += delta.Content
				lastMode = 2
				if len(sanitized) > 0 {
					lastChar = rune(sanitized[len(sanitized)-1])
				}
			}

			for _, tc := range delta.ToolCalls {
				if tc.Index == nil {
					continue
				}
				idx := *tc.Index
				if idx > maxIdx {
					maxIdx = idx
				}

				existing, ok := toolCallsMap[idx]
				if !ok {
					// Create a new ToolCall copy to avoid pointer issues with loop variables
					cp := tc
					toolCallsMap[idx] = &cp
					continue
				}

				existing.Function.Name += tc.Function.Name
				existing.Function.Arguments += tc.Function.Arguments
				if tc.ID != "" {
					existing.ID = tc.ID
				}
			}
		}
	}

	if maxIdx != -1 {
		assistantMsg.ToolCalls = make([]ToolCall, 0, maxIdx+1)
		for i := 0; i <= maxIdx; i++ {
			if tc, ok := toolCallsMap[i]; ok {
				assistantMsg.ToolCalls = append(assistantMsg.ToolCalls, *tc)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return Message{}, fmt.Errorf("error reading stream: %v", err)
	}

	return assistantMsg, nil
}

func printUsage() {
	fmt.Println("Usage: bootstrap [OPTIONS]")
	fmt.Println("")
	fmt.Println("Options:")
	fmt.Println("  -u, --url <url>           Endpoint base URL (typically includes '/v1')")
	fmt.Println("  -m, --model <model>       Model to call")
	fmt.Println("  -r, --reasoning <effort>  Reasoning effort (none, low, medium, high)")
	fmt.Println("      --help                Show this help message")
	fmt.Println("      --version             Show version and licensing information")
	fmt.Println("")
	fmt.Println("Set an API key, if needed, using the OPENAI_API_KEY environment variable.")
	fmt.Println("Unspecified options use OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_REASONING_EFFORT.")
}

func printVersion() {
	fmt.Println("LLM Terminal Bootstrap")
	fmt.Println(licenseText)
}

func main() {
	cfg := Config{
		BaseURL:         os.Getenv("OPENAI_BASE_URL"),
		APIKey:          os.Getenv("OPENAI_API_KEY"),
		Model:           os.Getenv("OPENAI_MODEL"),
		ReasoningEffort: os.Getenv("OPENAI_REASONING_EFFORT"),
	}

	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--help":
			printUsage()
			os.Exit(2)
		case "--version":
			printVersion()
			os.Exit(2)
		case "-u", "--url":
			if i+1 < len(args) {
				cfg.BaseURL = args[i+1]
				i++
			} else {
				fmt.Println("Error: --url requires a value")
				os.Exit(1)
			}
		case "-m", "--model":
			if i+1 < len(args) {
				cfg.Model = args[i+1]
				i++
			} else {
				fmt.Println("Error: --model requires a value")
				os.Exit(1)
			}
		case "-r", "--reasoning":
			if i+1 < len(args) {
				cfg.ReasoningEffort = args[i+1]
				i++
			} else {
				fmt.Println("Error: --reasoning requires a value")
				os.Exit(1)
			}
		default:
			fmt.Printf("Unknown option: %s\n", args[i])
			printUsage()
			os.Exit(1)
		}
	}

	if cfg.BaseURL == "" {
		fmt.Println("Must set an endpoint base URL via OPENAI_BASE_URL or --url.")
		os.Exit(1)
	}

	cfg.BaseURL = strings.TrimSuffix(cfg.BaseURL, "/")

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	fmt.Println("\033[1mLLM Terminal Bootstrap (Ctrl-C to interrupt or exit)\033[0m")
	fmt.Printf("\033[1mURL:\033[0m %s/chat/completions\n", cfg.BaseURL)
	if cfg.Model != "" {
		fmt.Printf("\033[1mModel:\033[0m %s\n", cfg.Model)
	}
	if cfg.ReasoningEffort != "" {
		fmt.Printf("\033[1mEffort:\033[0m %s\n", cfg.ReasoningEffort)
	}

	tools := getTools()
	var messages []Message
	messages = append(messages, Message{
		Role: "system",
		Content: "In a simple terminal chat." +
			"\n\n" +
			"Prefer surgical updates to files over full rewrites: " +
			"Use read_block to locate the specific section you want to change, " +
			"then use write_block to replace only that specific block." +
			"\n\n" +
			"You can not write to the filesystem without permission from the user. " +
			"They grant this permission by putting '/go' at the beginning or end of a prompt. " +
			"Do not make changes beyond those authorized by the '/go' prompt.",
	})

	reader := bufio.NewReader(os.Stdin)
	inputChan := make(chan string)
	errChan := make(chan error)

	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				errChan <- err
				return
			}
			inputChan <- line
		}
	}()

	for {
		fmt.Print("\n$ ")
		var userPrompt string
		select {
		case <-sigChan:
			return
		case err := <-errChan:
			if err == io.EOF {
				return
			}
			fmt.Printf("\033[31m[Error]\033[0m reading input: %v\n", err)
			return
		case line := <-inputChan:
			userPrompt = strings.TrimSpace(line)
			if userPrompt == `"""` {
				var buffer bytes.Buffer
				for {
					fmt.Print("> ")
					l, err := reader.ReadString('\n')
					if err != nil {
						break
					}
					if strings.TrimSpace(l) == `"""` {
						break
					}
					buffer.WriteString(l)
				}
				userPrompt = strings.TrimSpace(buffer.String())
			}
		}

		if userPrompt == "" {
			continue
		}

		messages = append(messages, Message{Role: "user", Content: userPrompt})
		writesAllowed := hasGoCommand(userPrompt)
		fmt.Println()

		turnCtx, cancel := context.WithCancel(context.Background())

		go func() {
			select {
			case <-sigChan:
				cancel()
			case <-turnCtx.Done():
			}
		}()

		for i := 0; ; i++ {
			assistantMsg, err := callEndpointStreaming(turnCtx, cfg, messages, tools, i == 0)

			if err != nil {
				if turnCtx.Err() != nil {
					fmt.Println("\nInterrupted! Returning to prompt...")
				} else {
					fmt.Printf("\033[31m[Error]\033[0m Request failed: %v\n", err)
				}
				break
			}

			messages = append(messages, assistantMsg)

			if assistantMsg.Content != "" || assistantMsg.Reasoning != "" || assistantMsg.ReasoningContent != "" {
				lastText := assistantMsg.Content
				if lastText == "" {
					lastText = assistantMsg.ReasoningContent
				}
				if lastText == "" {
					lastText = assistantMsg.Reasoning
				}

				if len(lastText) > 0 && lastText[len(lastText)-1] != '\n' {
					fmt.Print("\n")
				}
			}
			if len(assistantMsg.ToolCalls) == 0 {
				break
			}

			for _, tc := range assistantMsg.ToolCalls {
				if turnCtx.Err() != nil {
					break
				}
				result, err := executeTool(tc, writesAllowed)
				if err != nil {
					fmt.Printf("\033[31m[Error]\033[0m %s: %v\n", tc.Function.Name, err)
					result = fmt.Sprintf("Error: %v", err)
				}
				messages = append(messages, Message{
					Role:       "tool",
					Content:    result,
					ToolCallID: tc.ID,
				})
			}
			if turnCtx.Err() != nil {
				break
			}
		}
		cancel()
	}
}
