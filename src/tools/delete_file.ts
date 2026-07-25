import { type Tool } from "./types.ts";

interface DeleteFileArgs {
  path: string;
  recursive?: boolean;
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
          recursive: {
            type: "boolean",
            description: "If true, also delete non-empty directories. Default false.",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { fs }) => {
    const { path, recursive } = args as DeleteFileArgs;
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    fs.delete(path, { recursive: recursive === true });
    return `deleted ${path}`;
  },
};

export default deleteFileTool;
