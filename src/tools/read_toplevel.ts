import { type Tool } from "../types.ts";
import { getIndent } from "./read_block.ts";

interface ReadTopLevelArgs {
  path: string;
}

const readTopLevelTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_toplevel",
      description:
        "Quickly get a high-level overview of a file's structure (classes, functions, top-level variables) by reading only the non-indented lines. Use this instead of reading the whole file when you just need to understand the architecture.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read" },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path } = args as ReadTopLevelArgs;
    if (logInfo) {
      logInfo(`Reading toplevel: ${path}`);
    }
    try {
      const content = fs.read(path);
      const lines = content.split("\n");
      // Allow " *" so that we also preserve jsdoc and similar comments.
      const filtered = lines.filter((line) => !getIndent(line) || line.startsWith(" *")).join("\n");
      return filtered;
    } catch (e: any) {
      return `Error reading file ${path}: ${e.message}`;
    }
  },
};

export default readTopLevelTool;
