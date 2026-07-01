import { type Tool } from "../chat/types.ts";

interface MoveFileArgs {
  oldPath: string;
  newPath: string;
}

const moveFileTool: Tool = {
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
    if (typeof oldPath !== "string" || typeof newPath !== "string") {
      throw new Error("Arguments 'oldPath' and 'newPath' must be strings");
    }
    if (logInfo) {
      logInfo(`Moving file from ${oldPath} to ${newPath}`);
    }
    try {
      fs.move(oldPath, newPath);
      return `OK moved ${oldPath} to ${newPath}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default moveFileTool;
