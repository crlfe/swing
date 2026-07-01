import { type Tool } from "../chat/types.ts";

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
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (logInfo) {
      logInfo(`Reading file: ${path}`);
    }
    try {
      const content = fs.read(path);
      if (content.length > 100000) {
        return `ERR File ${path} is too large to read (${content.length} characters). Please use a more specific tool or request a partial read.`;
      }
      return `OK read ${path}\n${content}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default readFileTool;
