import { arrayGet } from "../util.ts";
import { type Tool } from "./types.ts";

interface ReplaceLinesArgs {
  path: string;
  search: string;
  replace: string;
}

const replaceLinesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "replace_lines",
      description:
        "Finds a search string in a file and replaces it with a replacement string. Matches lines by trimming whitespace to be resilient to indentation differences.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file to edit" },
          search: { type: "string", description: "The string to search for" },
          replace: { type: "string", description: "The string to replace it with" },
        },
        required: ["path", "search", "replace"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path, search, replace } = args as ReplaceLinesArgs;
    if (typeof path !== "string" || typeof search !== "string" || typeof replace !== "string") {
      throw new Error("Arguments 'path', 'search', and 'replace' must be strings");
    }
    if (logInfo) {
      logInfo(`Replacing lines in: ${path}`);
    }
    try {
      const content = fs.read(path);
      if (!content) {
        return `ERR File not found: ${path}`;
      }
      const searchLines = search.split(/\r?\n/);
      const trimmedSearchLines = searchLines.map((l) => l.trim());

      // Find all sequences of lines that match the trimmed search lines
      let matchStartIndex = -1;
      outer: for (let i = 0; i <= content.length - searchLines.length; i++) {
        for (let j = 0; j < searchLines.length; j++) {
          if (arrayGet(content, i + j).trim() !== trimmedSearchLines[j]) {
            continue outer;
          }
        }
        if (matchStartIndex < 0) {
          matchStartIndex = i;
        } else {
          return `ERR Multiple matches found for search string in ${path}. Please be more specific with the search string to ensure only one match exists.`;
        }
      }

      if (matchStartIndex < 0) {
        return `ERR Search string not found in file ${path} (tried line-by-line trimmed match)`;
      }

      const matchEndIndex = matchStartIndex + searchLines.length;

      // Construct new content
      const newLines = [
        ...content.slice(0, matchStartIndex),
        ...replace.split(/\r?\n/),
        ...content.slice(matchEndIndex),
      ];

      fs.write(path, newLines);

      return `OK edited ${path} to replace ${matchStartIndex + 1}-${matchEndIndex}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default replaceLinesTool;
