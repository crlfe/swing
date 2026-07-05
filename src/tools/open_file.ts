import { type Tool } from "./types.ts";

interface OpenFileArgs {
  path: string;
}

const openFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "open_file",
      description:
        "Opens a file and keeps it open. The content will automatically update in the chat history whenever the file is modified. Use this instead of read_file when you intend to make multiple edits to the same file to ensure you are always seeing the current state.",
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

    const content = fs.read(path);
    if (!content) {
      throw new Error(`File ${path} was not found`);
    }
    const contentString = content.join("\n");
    if (contentString.length > 100000) {
      throw new Error(
        `File ${path} is too large to open (${contentString.length} characters). Please use a more specific tool or request a partial read.`,
      );
    }

    const unsubscribe = fs.watch(
      path,
      () => {
        try {
          const newContent = fs.read(path);
          const newContentString = newContent ? newContent.join("\n") : "";
          const newResult = `OK open ${path}\n${newContentString}`;
          if (!context.updateToolResult(toolCallId, newResult)) {
            unsubscribe();
          }
        } catch (e: any) {
          if (!context.updateToolResult(toolCallId, `ERR ${e.message}`)) {
            unsubscribe();
          }
        }
      },
      { recursive: false },
    );

    return `open ${path}\n${contentString}`;
  },
};

export default openFileTool;
