import { type Tool } from "../types.ts";

interface ReadSkeletonArgs {
  path: string;
}

export const readSkeletonTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "read_skeleton",
      description:
        "Quickly get a high-level overview of a file's structure (classes, functions, top-level variables) by reading only the non-indented lines. Use this instead of reading the whole file when you just need to understand the architecture.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to read" },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path } = args as ReadSkeletonArgs;
    if (logInfo) {
      logInfo(`Reading skeleton of file: ${path}`);
    }
    try {
      const content = fs.read(path);
      const lines = content.split("\n");
      const skeleton = lines
        .filter((line) => line.trim() === "" || (!line.startsWith(" ") && !line.startsWith("\t")))
        .join("\n");
      return skeleton;
    } catch (e: any) {
      return `Error reading file ${path}: ${e.message}`;
    }
  },
};
