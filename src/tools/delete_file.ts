import { type Tool } from "../types.ts";

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
    if (logInfo) {
      logInfo(`Deleting file: ${path}`);
    }
    try {
      fs.delete(path);
      return `Successfully deleted ${path}`;
    } catch (e: any) {
      return `Error deleting file ${path}: ${e.message}`;
    }
  },
};

export default deleteFileTool;
