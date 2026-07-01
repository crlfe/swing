import { type Tool } from "../chat/types.ts";

interface InsertLinesArgs {
  path: string;
  content: string;
  search?: string;
}

const insertLinesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "insert_lines",
      description:
        "Inserts lines into a file before a specific search string. If no search string is provided, it inserts at the beginning of the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file" },
          content: { type: "string", description: "The content to insert" },
          search: {
            type: "string",
            description:
              "Optional search string. If provided, content is inserted before the first match.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path, content, search } = args as InsertLinesArgs;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error("Arguments 'path' and 'content' must be strings");
    }
    if (logInfo) {
      logInfo(`Inserting lines in: ${path}`);
    }
    try {
      const fileContent = fs.read(path);
      const fileLines = fileContent.split(/\r?\n/);
      const insertLines = content.split(/\r?\n/);

      if (!search) {
        const newLines = [...insertLines, ...fileLines];
        fs.write(path, newLines.join("\n"));
        return `OK inserted at beginning of ${path}`;
      }

      const searchLines = search
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "" || search.includes("\n"));
      const trimmedSearchLines = searchLines.map((l) => l.trim());

      let matchStartIndex = -1;
      for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (fileLines[i + j]?.trim() !== trimmedSearchLines[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          matchStartIndex = i;
          break;
        }
      }

      if (matchStartIndex === -1) {
        return `ERR Search string not found in file ${path}`;
      }

      const newLines = [
        ...fileLines.slice(0, matchStartIndex),
        ...insertLines,
        ...fileLines.slice(matchStartIndex),
      ];

      fs.write(path, newLines.join("\n"));
      return `OK inserted content before match in ${path}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default insertLinesTool;
