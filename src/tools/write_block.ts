import { type Tool } from "../types.ts";
import { findBlock } from "./read_block.ts";

interface WriteBlockArgs {
  path: string;
  searchLine: string;
  newContent: string;
}

const writeBlockTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_block",
      description:
        "Replace a logical block in a file with new content. It finds a line (like a function signature) and replaces the indented block following it. Use this to make precise edits to files without overwriting everything.",
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
      logInfo(`Writing block in ${path} starting with: ${JSON.stringify(searchLine)}`);
    }
    try {
      const content = fs.read(path);
      const lines = content.split("\n");

      let [startIndex, endIndex] = findBlock(lines, searchLine.trim());

      const newLines = lines.slice(0, startIndex + 1);
      const contentLines = newContent.split("\n");

      const updatedLines = [...newLines, ...contentLines, ...lines.slice(endIndex)];
      fs.write(path, updatedLines.join("\n"));

      return `Successfully wrote block in ${path}`;
    } catch (e: any) {
      console.error(e);
      return `Error writing block in ${path}: ${e.message}`;
    }
  },
};

export default writeBlockTool;
