import { type Tool } from "./types.ts";

interface WriteFileArgs {
  path: string;
  content: string;
  /**
   * Policy when the destination already exists: - "overwrite" (default): replace the existing
   * content. - "error": refuse to overwrite and throw. - "append": append the content as new lines
   * after existing content.
   */
  ifExists?: "overwrite" | "error" | "append";
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
          ifExists: {
            type: "string",
            enum: ["overwrite", "error", "append"],
            description:
              "Optional policy when the file exists: 'overwrite' (default), 'error', or 'append'.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: async (args, { fs }) => {
    const { path, content, ifExists } = args as WriteFileArgs;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error("Arguments 'path' and 'content' must be strings");
    }
    if (ifExists !== undefined && !["overwrite", "error", "append"].includes(ifExists)) {
      throw new Error("Argument 'ifExists' must be 'overwrite', 'error', or 'append'");
    }

    const existed = fs.has(path);
    if (existed && ifExists === "error") {
      throw new Error(`File already exists: ${path}`);
    }

    const newLines = content.split(/\r?\n/);
    const lines = existed && ifExists === "append" ? [...fs.read(path), ...newLines] : newLines;
    const changed = fs.write(path, lines);

    if (!existed) return `wrote ${path} (new)`;
    if (!changed) return `wrote ${path} (unchanged)`;
    return `wrote ${path} (updated)`;
  },
};

export default writeFileTool;
