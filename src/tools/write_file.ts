import { type Tool } from "./types.ts";

interface WriteFileArgs {
  path: string;
  content: string;
}

const writeFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "write_file",
      description: "Writes content to a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to write" },
          content: { type: "string", description: "The content to write to the file" },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: async (args, { fs, logInfo }) => {
    const { path, content } = args as WriteFileArgs;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error("Arguments 'path' and 'content' must be strings");
    }
    if (logInfo) {
      logInfo(`Writing file: ${path}`);
    }
    fs.write(path, content.split(/\r?\n/));
    return `wrote ${path}`;
  },
};

export default writeFileTool;
