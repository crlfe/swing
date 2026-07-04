import { type Tool } from "./types.ts";

interface ReadFileArgs {
  path: string;
}

const readFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Reads the content of a file. This is a one-time read and will not update if the file changes.",
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
      if (!content) {
        return `ERR File not found: ${path}`;
      }
      const contentString = content.join("\n");
      if (contentString.length > 100000) {
        return `ERR File ${path} is too large to read (${contentString.length} characters). Please use a more specific tool or request a partial read.`;
      }
      return `OK read ${path}\n${contentString}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default readFileTool;
