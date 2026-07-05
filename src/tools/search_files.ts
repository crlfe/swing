import { type Tool } from "./types.ts";

interface SearchFilesArgs {
  query: string;
}

const searchFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "search_files",
      description: "Searches for a string across all files in the project",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The string to search for" },
        },
        required: ["query"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { query } = args as SearchFilesArgs;
    if (typeof query !== "string") {
      throw new Error("Argument 'query' must be a string");
    }
    if (logInfo) {
      logInfo(`Searching files: ${query}`);
    }
    const results: string[] = [];

    fs.walk("", (path, node) => {
      if (node.type === "blob") {
        const content = node.content;
        const contentString = content ? content.join("\n") : "";
        if (contentString.includes(query)) {
          results.push(path);
        }
      }
    });

    if (results.length === 0) {
      return `search found no results ${query}`;
    }
    return `search found ${query}\n${results.join("\n")}\n`;
  },
};

export default searchFilesTool;
