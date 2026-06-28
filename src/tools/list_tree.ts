import { type Tool } from "../types.ts";

const listTreeTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "list_tree",
      description: "Recursively lists a directory tree",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "The root directory to start listing from",
          },
          depth: {
            type: "number",
            description: "The maximum depth to recurse",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (args: { path: string; depth?: number }, { logInfo, fs }) => {
    if (logInfo) {
      logInfo(`Listing tree: ${args.path}`);
    }
    try {
      const fullTree = fs.getTree();

      const findNode = (node: any, targetPath: string): any => {
        if (node.path === targetPath) return node;
        for (const child of node.children) {
          const result = findNode(child, targetPath);
          if (result) return result;
        }
        return null;
      };

      let startNode: any;
      if (args.path) {
        const normalizedPath = args.path.replace(/^\//, "");
        if (normalizedPath === "") {
          startNode = fullTree;
        } else {
          startNode = findNode(fullTree, normalizedPath);
        }
      } else {
        startNode = fullTree;
      }

      if (!startNode) {
        return `Directory not found: ${args.path}`;
      }

      const formatNode = (
        node: any,
        prefix: string,
        isLast: boolean,
        currentDepth: number,
        maxDepth: number | undefined,
      ) => {
        const connector = isLast ? "└── " : "├── ";
        const line = `${prefix}${connector}${node.name}`;

        if (node.isDirectory && node.children && (!maxDepth || currentDepth < maxDepth)) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          const childrenLines = node.children
            .map((child: any, index: number) =>
              formatNode(
                child,
                newPrefix,
                index === node.children.length - 1,
                currentDepth + 1,
                maxDepth,
              ),
            )
            .join("\n");
          return childrenLines ? `${line}\n${childrenLines}` : line;
        }
        return line;
      };

      // If we are starting from the dummy root, we list its children.
      // If we are starting from a specific node, we list its children.
      // But we should probably include the node itself if it's not the dummy root.

      if (startNode === fullTree) {
        const children = startNode.children;
        const result = children
          .map((node: any, index: number) =>
            formatNode(node, "", index === children.length - 1, 1, args.depth),
          )
          .join("\n");
        return result || "The directory is empty.";
      } else {
        // Show the startNode itself, then its children
        const result = formatNode(startNode, "", true, 1, args.depth);
        // Wait, formatNode adds a prefix and connector.
        // If it's the root of our view, we might want it without the connector if it's just one node.
        // But let's keep it simple.
        return result;
      }
    } catch (e: any) {
      return `Error listing directory tree: ${e.message}`;
    }
  },
};

export default listTreeTool;
