import { type Tool } from "./types.ts";

interface SearchFilesArgs {
  query: string;
  maxResults?: number;
}

const MAX_RESULTS = 100;

const searchFilesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Searches for a string across all files in the project. Returns each matching file with the line numbers and matching lines. Results are capped to avoid overwhelming output.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The string to search for" },
          maxResults: {
            type: "number",
            description: "Optional cap on number of files reported (default 100).",
          },
        },
        required: ["query"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { query, maxResults } = args as SearchFilesArgs;
    if (typeof query !== "string") {
      throw new Error("Argument 'query' must be a string");
    }
    const limit = typeof maxResults === "number" && maxResults > 0 ? maxResults : MAX_RESULTS;
    if (logInfo) {
      logInfo(`Searching files: ${query}`);
    }

    const results: string[] = [];
    fs.walk("", (path, node) => {
      if (results.length >= limit) return;
      if (node.type === "blob") {
        const content = node.content;
        const contentString = content ? content.join("\n") : "";
        if (contentString.includes(query)) {
          const matches: string[] = [];
          content.forEach((line, idx) => {
            if (line.includes(query)) matches.push(`${idx + 1}: ${line}`);
          });
          results.push(`${path}\n${matches.join("\n")}`);
        }
      }
    });

    if (results.length === 0) {
      return `searched files (0 matches for "${query}")`;
    }
    const truncated = results.length >= limit ? " (results capped)" : "";
    return `searched files (${results.length} matches for "${query}"${truncated})\n${results.join("\n")}\n`;
  },
};

export default searchFilesTool;
