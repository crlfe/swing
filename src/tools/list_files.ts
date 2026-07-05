import { type Tool } from "./types.ts";

const listFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_files",
      description: "Lists the immediate children of a specified path",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The directory path to list children from",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args: { path: string }, { logInfo, fs }) => {
    if (typeof args.path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    if (logInfo) {
      logInfo(`Listing files: ${args.path}`);
    }
    const normalizedPath = args.path.replace(/^\//, "");
    const startNode = fs.getNode(normalizedPath);
    if (!startNode) {
      throw new Error(`Path not found: ${args.path}`);
    }

    if (startNode.type !== "dir") {
      throw new Error(`Path is not a directory: ${args.path}`);
    }

    const children = Array.from(startNode.children.entries()).map(
      ([name, child]: [string, any]) => {
        return child.type === "dir" ? `${name}/` : name;
      },
    );

    if (!children.length) {
      return `listed empty directory ${args.path}`;
    } else {
      return `listed ${args.path}\n${children.join("\n")}\n`;
    }
  },
};

export default listFilesTool;
