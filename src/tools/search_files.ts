import { type Tool } from "../chat/types.ts";

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
    try {
      const files = fs.list();
      const results: string[] = [];

      for (const file of files) {
        const content = fs.read(file);
        if (content.includes(query)) {
          results.push(file);
        }
      }

      if (results.length === 0) {
        return `OK search found no results ${query}`;
      }
      return `OK search found ${query}\n${results.join("\n")}\n`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default searchFilesTool;
