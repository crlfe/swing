import { type Tool } from "../types";

export const listDirectoryTreeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_directory_tree",
      description: "Recursively lists a directory tree",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    if (logInfo) {
      logInfo("Listing directory tree...");
    }
    try {
      const root = fs.getTree();

      const formatNode = (node: any, prefix = "", isLast = true) => {
        const connector = isLast ? "└── " : "├── ";
        const line = `${prefix}${connector}${node.name}`;

        if (node.isDirectory && node.children) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          const childrenLines = node.children
            .map((child: any, index: number) =>
              formatNode(child, newPrefix, index === node.children.length - 1),
            )
            .join("\n");
          return childrenLines ? `${line}\n${childrenLines}` : line;
        }
        return line;
      };

      const result = root.children
        .map((node: any, index: number) => formatNode(node, "", index === root.children.length - 1))
        .join("\n");

      return result || "The directory is empty.";
    } catch (e: any) {
      return `Error listing directory tree: ${e.message}`;
    }
  },
};
