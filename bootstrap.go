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
	"strings"
	"syscall"
	"unicode"
)

//go:embed LICENSE.txt
var licenseText string

// --- Constants ---

const MaxFileSize = 1 * 1024 * 1024 // 1MB limit for reading/grepping files

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

type RequestMessage struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
}

type ChatRequest struct {
	Model           string           `json:"model"`
	Messages        []RequestMessage `json:"messages"`
	Tools           []Tool           `json:"tools,omitempty"`
	Stream          bool             `json:"stream"`
	ReasoningEffort string           `json:"reasoning_effort,omitempty"`
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
	Description string
	Parameters  JSObject
	Handler     ToolHandler
}

var toolRegistry = map[string]ToolRegistration{
	"read_file": {
		Description: "Read file contents",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		Handler: handleReadFile,
	},
	"read_block": {
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
		Handler: handleReadBlock,
	},
	"write_block": {
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
		Handler: handleWriteBlock,
	},
	"write_file": {
		Description: "Create a new file or completely overwrite an existing one. Use this only for new files or total rewrites.",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":    JSObject{"type": "string"},
				"content": JSObject{"type": "string"},
			},
			"required": []string{"path", "content"},
		},
		Handler: handleWriteFile,
	},
	"list_dir": {
		Description: "List directory files",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		Handler: handleListDir,
	},
	"find_files": {
		Description: "Search for files whose names match a glob pattern",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":    JSObject{"type": "string", "description": "Root directory to start search"},
				"pattern": JSObject{"type": "string", "description": "Glob pattern (e.g. *.go)"},
			},
			"required": []string{"path", "pattern"},
		},
		Handler: handleFindFiles,
	},
	"grep_files": {
		Description: "Search for files containing a specified string",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path":  JSObject{"type": "string", "description": "Root directory to start search"},
				"query": JSObject{"type": "string", "description": "String to search for in file contents"},
			},
			"required": []string{"path", "query"},
		},
		Handler: handleGrepFiles,
	},
	"delete_file": {
		Description: "Delete a file (errors if the path is a directory)",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		Handler: handleDeleteFile,
	},
	"create_dir": {
		Description: "Create a new directory",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		Handler: handleCreateDir,
	},
	"delete_dir": {
		Description: "Delete an empty directory (errors if not empty)",
		Parameters: JSObject{
			"type": "object",
			"properties": JSObject{
				"path": JSObject{"type": "string"},
			},
			"required": []string{"path"},
		},
		Handler: handleDeleteDir,
	},
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

func splitFileOnString(path string, search string, startLine, endLine int) (before, match, after string, err error) {
	info, err := os.Stat(path)
	if err != nil {
		return "", "", "", err
	}
	if info.Size() > MaxFileSize {
		return "", "", "", fmt.Errorf("file is too large to process (%d bytes, max %d)", info.Size(), MaxFileSize)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", "", "", err
	}
	sContent := string(content)

	// If lines are specified, we need to find the byte offsets of those lines
	var searchStart, searchEnd int
	if startLine > 0 || endLine > 0 {
		lines := strings.Split(sContent, "\n")
		if startLine > len(lines) {
			return "", "", "", fmt.Errorf("start_line %d is beyond file length %d", startLine, len(lines))
		}
		if endLine > 0 && endLine < startLine {
			return "", "", "", fmt.Errorf("end_line cannot be less than start_line")
		}

		// Calculate searchStart byte offset
		if startLine > 1 {
			for i := 0; i < startLine-1; i++ {
				searchStart += len(lines[i]) + 1 // +1 for the \n
			}
		}

		// Calculate searchEnd byte offset
		if endLine > 0 && endLine < len(lines) {
			for i := 0; i < endLine; i++ {
				searchEnd += len(lines[i]) + 1
			}
		} else {
			searchEnd = len(sContent)
		}
	} else {
		searchStart = 0
		searchEnd = len(sContent)
	}

	searchArea := sContent[searchStart:searchEnd]
	idx := strings.Index(searchArea, search)
	if idx == -1 {
		return "", "", "", fmt.Errorf("search string not found in file (within lines %d-%d)", startLine, endLine)
	}

	if strings.Contains(searchArea[idx+1:], search) {
		return "", "", "", fmt.Errorf("search string found multiple times in search area")
	}

	absIdx := searchStart + idx
	return sContent[:absIdx], sContent[absIdx : absIdx+len(search)], sContent[absIdx+len(search):], nil
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
			if errorCount <= 4 {
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

	if errorCount > 4 {
		fmt.Fprintf(os.Stderr, "\033[31m[Walk Error]\033[0m Suppressed %d additional errors\n", errorCount-4)
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
	if info.Size() > MaxFileSize {
		return "", fmt.Errorf("file is too large to read (%d bytes, max %d)", info.Size(), MaxFileSize)
	}

	b, err := os.ReadFile(safePath)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func handleReadBlock(argsJSON string) (string, error) {
	var args ReadBlockArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	firstLineOfQuery := ""
	if lines := strings.Split(args.Query, "\n"); len(lines) > 0 {
		firstLineOfQuery = lines[0]
	}

	rangeStr := getRangeString(args.StartLine, args.EndLine)
	logToolCall("read_block %q find %q%s", args.Path, firstLineOfQuery, rangeStr)
	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	_, match, after, err := splitFileOnString(safePath, args.Query, args.StartLine, args.EndLine)
	if err != nil {
		return "", err
	}

	// We combine the match and the subsequent content to process as a stream of lines
	content := match + after
	scanner := bufio.NewScanner(strings.NewReader(content))
	var block []string
	var startIndent int
	firstLine := true

	for scanner.Scan() {
		line := scanner.Text()
		if firstLine {
			block = append(block, line)
			startIndent = len(line) - len(strings.TrimLeft(line, " \t"))
			firstLine = false
			continue
		}

		if strings.TrimSpace(line) == "" {
			block = append(block, line)
			continue
		}

		indent := len(line) - len(strings.TrimLeft(line, " \t"))
		if indent <= startIndent {
			break
		}
		block = append(block, line)
	}

	if err := scanner.Err(); err != nil {
		return "", err
	}

	return strings.Join(block, "\n"), nil
}

func handleWriteBlock(argsJSON string) (string, error) {
	var args WriteBlockArgs
	if err := unmarshalStrict([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("Argument error: %v", err)
	}

	firstLine := ""
	if lines := strings.Split(args.OldBlock, "\n"); len(lines) > 0 {
		firstLine = lines[0]
	}

	rangeStr := getRangeString(args.StartLine, args.EndLine)
	logToolCall("write_block %q replace %q%s", args.Path, firstLine, rangeStr)

	safePath, err := resolvePath(args.Path)
	if err != nil {
		return "", err
	}

	before, _, after, err := splitFileOnString(safePath, args.OldBlock, args.StartLine, args.EndLine)
	if err != nil {
		return "", err
	}

	newContent := before + args.NewBlock + after
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
		if info.Size() > MaxFileSize {
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

func executeTool(tc ToolCall) (string, error) {
	reg, ok := toolRegistry[tc.Function.Name]
	if !ok {
		return "", fmt.Errorf("Unknown tool: %s", tc.Function.Name)
	}
	return reg.Handler(tc.Function.Arguments)
}

func getTools() []Tool {
	var tools []Tool
	for name, reg := range toolRegistry {
		tools = append(tools, Tool{
			Type: "function",
			Function: FunctionDef{
				Name:        name,
				Description: reg.Description,
				Parameters:  reg.Parameters,
			},
		})
	}
	return tools
}

func callEndpointStreaming(ctx context.Context, cfg Config, messages []Message, tools []Tool, isFirstTurn bool) (Message, error) {
	reqMessages := make([]RequestMessage, 0, len(messages))
	for _, m := range messages {
		reqMessages = append(reqMessages, RequestMessage{
			Role:       m.Role,
			Content:    m.Content,
			ToolCallID: m.ToolCallID,
			ToolCalls:  m.ToolCalls,
		})
	}

	reqBody := ChatRequest{
		Model:           cfg.Model,
		Messages:        reqMessages,
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
		Role:    "system",
		Content: "You are an expert developer with filesystem access. When modifying files, prefer surgical updates over full rewrites. Strategy: Use read_block to locate the specific section you want to change, then use write_block to replace only that specific block. Avoid write_file for existing files unless you are creating a new file or the changes are so extensive that a rewrite is more efficient. Please provide high-quality, step-by-step reasoning for your actions.",
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
				result, err := executeTool(tc)
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
