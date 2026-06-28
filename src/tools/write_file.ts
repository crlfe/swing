import { debouncedRefreshPreview } from "../preview.ts";
import { state } from "../state.ts";
import { type Tool } from "../types.ts";

interface WriteFileArgs {
  path: string;
  content: string;
}

export const writeFileTool: Tool = {
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
    if (logInfo) {
      logInfo(`Writing to file: ${path}`);
    }
    try {
      fs.write(path, content);

      // Update editor view if open
      state.updateViewContent(path, content);
      // Update preview
      debouncedRefreshPreview(state.activeHtmlFile, fs, state.views);

      return `Successfully wrote to ${path}`;
    } catch (e: any) {
      return `Error writing to file ${path}: ${e.message}`;
    }
  },
};
