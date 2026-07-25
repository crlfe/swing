import { type Tool } from "./types.ts";

interface ReadFileArgs {
  path: string;
  startLine?: number;
  endLine?: number;
}

const MAX_CHARS = 100000;

const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Reads the content of a file. This is a one-time read and will not update if the file changes. Optionally read a subset of lines with startLine/endLine (1-based, inclusive; endLine may be omitted to read to the end).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read" },
          startLine: {
            type: "number",
            description: "Optional 1-based start line (inclusive). Defaults to 1.",
          },
          endLine: {
            type: "number",
            description: "Optional 1-based end line (inclusive). Defaults to the last line.",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { fs }) => {
    const { path, startLine, endLine } = args as ReadFileArgs;
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (
      (startLine !== undefined && !Number.isInteger(startLine)) ||
      (endLine !== undefined && !Number.isInteger(endLine))
    ) {
      throw new Error("Arguments 'startLine' and 'endLine' must be integers");
    }

    const content = fs.read(path);
    const totalLines = content.length;

    if (totalLines === 0) {
      return `read ${path} (empty file)`;
    }

    let from = startLine !== undefined ? startLine : 1;
    let to = endLine !== undefined ? endLine : totalLines;
    if (from < 1) from = 1;
    if (to > totalLines) to = totalLines;
    if (from > to) {
      throw new Error(`Invalid line range for ${path}: startLine ${from} is after endLine ${to}`);
    }

    const selected = content.slice(from - 1, to);
    const contentString = selected.join("\n");

    if (contentString.length > MAX_CHARS) {
      throw new Error(
        `Selection from ${path} is too large to read (${contentString.length} characters). Narrow the line range.`,
      );
    }

    const wasPartial = from > 1 || to < totalLines;
    const rangeSuffix = wasPartial ? ` (lines ${from}-${to} of ${totalLines})` : ` (${totalLines} line${totalLines > 1 ? "s" : ""})`;
    return `read ${path}${rangeSuffix}\n${contentString}`;
  },
};

export default readFileTool;
