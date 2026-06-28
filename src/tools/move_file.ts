import { type Tool } from "../types.ts";

interface MoveFileArgs {
  oldPath: string;
  newPath: string;
}

export const moveFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "move_file",
      description: "Moves or renames a file from one path to another",
      parameters: {
        type: "object",
        properties: {
          oldPath: { type: "string", description: "The current path of the file" },
          newPath: { type: "string", description: "The destination path" },
        },
        required: ["oldPath", "newPath"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { oldPath, newPath } = args as MoveFileArgs;
    if (logInfo) {
      logInfo(`Moving file from ${oldPath} to ${newPath}`);
    }
    try {
      fs.move(oldPath, newPath);
      return `Successfully moved ${oldPath} to ${newPath}`;
    } catch (e: any) {
      return `Error moving file from ${oldPath} to ${newPath}: ${e.message}`;
    }
  },
};
