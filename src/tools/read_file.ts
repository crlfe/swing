import { type Tool } from "../types.ts";

interface ReadFileArgs {
  path: string;
}

const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the content of a file",
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
    const { path } = args as ReadFileArgs;
    if (logInfo) {
      logInfo(`Reading file: ${path}`);
    }
    try {
      return fs.read(path);
    } catch (e: any) {
      return `Error reading file ${path}: ${e.message}`;
    }
  },
};

export default readFileTool;
