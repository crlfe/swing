import { type Tool } from "./types.ts";

interface DeleteFileArgs {
  path: string;
}

const deleteFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "delete_file",
      description: "Deletes a file from the file system",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to delete" },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path } = args as DeleteFileArgs;
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (logInfo) {
      logInfo(`Deleting file: ${path}`);
    }
    fs.delete(path);
    return `deleted ${path}`;
  },
};

export default deleteFileTool;
