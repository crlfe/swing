import { type Tool } from "../types.ts";

interface ReadBlockArgs {
  path: string;
  searchLine: string;
}

const readBlockTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_block",
      description:
        "Extract a logical block from a file. It finds a line (like a function signature) and returns the indented block following it. Use this to read precise parts of a file rather than the entire thing.",
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
      logInfo(`Reading block in ${path} starting with: ${JSON.stringify(searchLine)}`);
    }
    try {
      const content = fs.read(path);
      const lines = content.split("\n");

      let [startIndex, endIndex] = findBlock(lines, searchLine.trim());
      return lines.slice(startIndex + 1, endIndex).join("\n");
    } catch (e: any) {
      return `Error reading block in ${path}: ${e.message}`;
    }
  },
};

export function findBlock(lines: string[], searchLineTrimmed: string): [number, number] {
  let startIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(searchLineTrimmed)) {
      if (startIndex < 0) {
        startIndex = i;
      } else {
        throw new Error("searchLine matched multiple locations");
      }
    }
  }
  if (startIndex < 0) {
    throw new Error("searchLine not found");
  }

  const startIndent = getIndent(lines[startIndex]);
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() && getIndent(lines[i]) <= startIndent) {
      endIndex = i;
      break;
    }
  }

  return [startIndex, endIndex];
}

export function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

export default readBlockTool;
