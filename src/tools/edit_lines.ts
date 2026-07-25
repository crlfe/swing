import { findSingleMatch, splitSearchLines } from "./match.ts";
import { type Tool } from "./types.ts";

interface EditLinesArgs {
  path: string;
  search: string;
  content: string;
  mode?: "replace" | "before" | "after";
}

const editLinesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_lines",
      description:
        "Edits a file by locating line(s) and changing them. The 'search' string identifies where to act. Use 'mode' to say what happens to the matched lines: 'replace' swaps them for 'content'; 'before' inserts 'content' directly above them; 'after' inserts 'content' directly below them.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to edit" },
          search: {
            type: "string",
            description: "The line(s) to locate.",
          },
          content: {
            type: "string",
            description: "The line(s) to write.",
          },
          mode: {
            type: "string",
            enum: ["replace", "before", "after"],
            description: "What to do with the matched lines. Default 'replace'.",
          },
        },
        required: ["path", "search", "content"],
      },
    },
  },
  execute: async (args, { fs }) => {
    const { path, search, content, mode } = args as EditLinesArgs;
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (typeof search !== "string") {
      throw new Error("Argument 'search' must be a string");
    }
    if (typeof content !== "string") {
      throw new Error("Argument 'content' must be a string");
    }
    const resolvedMode: "replace" | "before" | "after" = mode ?? "replace";
    if (!["replace", "before", "after"].includes(resolvedMode)) {
      throw new Error("Argument 'mode' must be 'replace', 'before', or 'after'");
    }

    const fileLines = fs.read(path);
    const newLines = content !== undefined ? content.split(/\r?\n/) : [];

    const searchLines = splitSearchLines(search);
    const matchStart = findSingleMatch(fileLines, searchLines, path);
    const matchEnd = matchStart + searchLines.length;

    let newContent: string[];
    let result: string;
    if (resolvedMode === "replace") {
      newContent = [...fileLines.slice(0, matchStart), ...newLines, ...fileLines.slice(matchEnd)];
      if (matchStart + 1 < matchEnd) {
        result = `edited ${path} (lines ${matchStart + 1}-${matchEnd} replaced)`;
      } else {
        result = `edited ${path} (line ${matchStart + 1} replaced)`;
      }
    } else if (resolvedMode === "before") {
      newContent = [...fileLines.slice(0, matchStart), ...newLines, ...fileLines.slice(matchStart)];
      result = `edited ${path} (inserted before line ${matchStart + 1})`;
    } else if (resolvedMode === "after") {
      newContent = [...fileLines.slice(0, matchEnd), ...newLines, ...fileLines.slice(matchEnd)];
      result = `edited ${path} (inserted after line ${matchEnd})`;
    } else {
      throw new Error("Argument 'mode' must be 'replace', 'before', or 'after'");
    }

    fs.write(path, newContent);
    return result;
  },
};

export default editLinesTool;
