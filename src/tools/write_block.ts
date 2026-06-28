import { type Tool } from "../types.ts";

interface WriteBlockArgs {
  path: string;
  searchLine: string;
  newContent: string;
}

export const writeBlockTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_block",
      description:
        "Replace a specific logical block of code in a file with new content. It finds a line (e.g., a function signature), identifies the indented block following it, and replaces that block. Use this to make precise edits to large files without overwriting everything.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file" },
          searchLine: { type: "string", description: "The line to search for" },
          newContent: { type: "string", description: "The new content to replace the block with" },
        },
        required: ["path", "searchLine", "newContent"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path, searchLine, newContent } = args as WriteBlockArgs;
    if (logInfo) {
      logInfo(`Writing block in ${path} starting with: ${searchLine}`);
    }
    try {
      const content = fs.read(path);
      const lines = content.split("\n");
      let startIndex = -1;
      let startIndent = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().includes(searchLine.trim())) {
          startIndex = i;
          startIndent = getIndent(lines[i]);
          break;
        }
      }

      if (startIndex === -1) {
        return `Line "${searchLine}" not found in ${path}`;
      }

      let endIndex;
      for (endIndex = startIndex + 1; endIndex < lines.length; endIndex++) {
        if (getIndent(lines[endIndex]) <= startIndent) {
          break;
        }
      }

      const newLines = lines.slice(0, startIndex + 1);
      const contentLines = newContent.split("\n");

      const updatedLines = [...newLines, ...contentLines, ...lines.slice(endIndex)];
      fs.write(path, updatedLines.join("\n"));

      return `Successfully wrote block in ${path}`;
    } catch (e: any) {
      return `Error writing block in ${path}: ${e.message}`;
    }
  },
};

function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
