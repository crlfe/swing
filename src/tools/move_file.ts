import { type Tool } from "./types.ts";

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
  execute: async (args, { fs }) => {
    const { oldPath, newPath } = args as MoveFileArgs;
    if (typeof oldPath !== "string" || typeof newPath !== "string") {
      throw new Error("Arguments 'oldPath' and 'newPath' must be strings");
    }
    const overwrote = fs.has(newPath);
    if (overwrote && fs.getNode(newPath).type !== "blob") {
      throw new Error("Destination already exists");
    }
    fs.move(oldPath, newPath);
    return overwrote
      ? `moved ${oldPath} to ${newPath} (overwrote)`
      : `moved ${oldPath} to ${newPath} (new)`;
  },
};

export default moveFileTool;
