import { type Tool } from "../types";

interface ReadBlockArgs {
  path: string;
  searchLine: string;
}

export const readBlockTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_block",
      description:
        "Extract a specific logical block of code from a file by searching for a line (like a function signature) and returning all subsequent indented lines. Use this to read only the relevant part of a large file rather than the entire thing.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file" },
          searchLine: { type: "string", description: "The line to search for" },
        },
        required: ["path", "searchLine"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path, searchLine } = args as ReadBlockArgs;
    if (logInfo) {
      logInfo(`Reading block in ${path} starting with: ${searchLine}`);
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

      return lines.slice(startIndex + 1, endIndex).join("\n");
    } catch (e: any) {
      return `Error reading block in ${path}: ${e.message}`;
    }
  },
};

function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}
