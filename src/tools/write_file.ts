import { type Tool } from "../chat/types.ts";
import { debouncedRefreshPreview } from "../preview.ts";
import { state } from "../state.ts";

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
    try {
      fs.write(path, content);

      // Update editor view if open
      if ("document" in globalThis) {
        state.updateViewContent(path, content);
        // Update preview
        debouncedRefreshPreview(state.activeHtmlFile, fs, state.views);
      }

      return `OK wrote ${path}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default writeFileTool;
