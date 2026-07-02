import { type Tool } from "../chat/types.ts";

interface OpenFileArgs {
  path: string;
}

const openFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "open_file",
      description:
        "Opens the content of a file. The content will automatically update when the file changes, so prefer this tool over read_file when you are going to be editing a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to open" },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { logInfo, fs, context }, toolCallId: string) => {
    const { path } = args as OpenFileArgs;
    if (typeof path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (logInfo) {
      logInfo(`Opening file: ${path}`);
    }
    try {
      const content = fs.read(path);
      if (content.length > 100000) {
        return `ERR File ${path} is too large to open (${content.length} characters). Please use a more specific tool or request a partial read.`;
      }

      const result = `OK open ${path}\n${content}`;

      const listener = (e: any) => {
        const { detail } = e;
        if (detail.path === path) {
          try {
            const newContent = fs.read(path);
            const newResult = `OK open ${path}\n${newContent}`;
            if (!context.updateToolResult(toolCallId, newResult)) {
              fs.removeEventListener("change", listener);
            }
          } catch (e: any) {
            if (!context.updateToolResult(toolCallId, `ERR ${e.message}`)) {
              fs.removeEventListener("change", listener);
            }
          }
        }
      };

      fs.addEventListener("change", listener);

      return result;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default openFileTool;
