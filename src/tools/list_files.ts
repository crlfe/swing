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
  execute: async (args: { path: string }, { fs }) => {
    if (typeof args.path !== "string") {
      throw new Error("Argument 'path' must be a string");
    }
    const startNode = fs.getNode(args.path);
    if (startNode.type !== "dir") {
      throw new Error(`Path is not a directory: ${args.path}`);
    }

    const children = Array.from(startNode.children.entries()).map(
      ([name, child]: [string, any]) => {
        return child.type === "dir" ? `${name}/` : name;
      },
    );

    if (!children.length) {
      return `listed ${args.path} (empty directory)`;
    } else {
      return `listed ${args.path} (${children.length} files found)\n${children.sort().join("\n")}\n`;
    }
  },
};

export default listFilesTool;
