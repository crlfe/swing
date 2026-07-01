import { type Tool } from "../chat/types.ts";

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
    try {
      const fullTree = fs.getTree();
      const normalizedPath = args.path.replace(/^\//, "");

      const findNode = (node: any, targetPath: string): any => {
        if (node.path === targetPath) return node;
        for (const child of node.children) {
          const result = findNode(child, targetPath);
          if (result) return result;
        }
        return null;
      };

      let startNode: any;
      if (normalizedPath === "") {
        startNode = fullTree;
      } else {
        startNode = findNode(fullTree, normalizedPath);
      }

      if (!startNode) {
        return `ERR Path not found: ${args.path}`;
      }

      if (!startNode.isDirectory) {
        return `ERR Path is not a directory: ${args.path}`;
      }

      const children = startNode.children.map((child: any) => {
        return child.isDirectory ? `${child.name}/` : child.name;
      });

      if (!children.length) {
        return `OK listed empty directory ${args.path}`;
      } else {
        return `OK listed ${args.path}\n${children.join("\n")}\n`;
      }
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default listFilesTool;
