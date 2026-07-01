import { type Tool } from "../chat/types.ts";
import { arrayGet } from "../util.ts";

interface EditFileArgs {
  path: string;
  search: string;
  replace: string;
}

const editFileTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "edit_file",
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
    const { path, search, replace } = args as EditFileArgs;
    if (typeof path !== "string" || typeof search !== "string" || typeof replace !== "string") {
      throw new Error("Arguments 'path', 'search', and 'replace' must be strings");
    }
    if (logInfo) {
      logInfo(`Editing file: ${path}`);
    }
    try {
      const content = fs.read(path);
      const fileLines = content.split(/\r?\n/);
      const searchLines = search
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "" || search.includes("\n"));

      // If search is empty after filtering, fallback to basic check
      if (searchLines.length === 0 && search.trim() === "") {
        return `Search string is empty`;
      }

      const trimmedSearchLines = searchLines.map((l) => l.trim());

      // Find all sequences of lines that match the trimmed search lines
      const matches: number[] = [];
      for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (arrayGet(fileLines, i + j).trim() !== trimmedSearchLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matches.push(i);
        }
      }

      const matchStartIndex = matches[0];
      if (matchStartIndex == undefined) {
        return `ERR Search string not found in file ${path} (tried line-by-line trimmed match)`;
      }
      if (matches.length > 1) {
        return `ERR Multiple matches found for search string in ${path}. Please be more specific with the search string to ensure only one match exists.`;
      }

      const matchEndIndex = matchStartIndex + searchLines.length;

      // Construct new content
      const newLines = [
        ...fileLines.slice(0, matchStartIndex),
        ...replace.split(/\r?\n/),
        ...fileLines.slice(matchEndIndex),
      ];

      const newContent = newLines.join("\n");
      fs.write(path, newContent);

      return `OK edited ${path} to replace ${matchStartIndex + 1}-${matchEndIndex}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default editFileTool;
