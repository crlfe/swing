import { type Tool } from "../chat/types.ts";

interface AppendInsertArgs {
  path: string;
  content: string;
  search?: string;
}

const appendLinesTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "append_lines",
      description:
        "Appends lines to the end of a file, or after a specific search string. If no search string is provided, it appends to the end of the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "The path to the file" },
          content: { type: "string", description: "The content to append" },
          search: {
            type: "string",
            description:
              "Optional search string. If provided, content is appended after the first match.",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  execute: async (args, { logInfo, fs }) => {
    const { path, content, search } = args as AppendInsertArgs;
    if (typeof path !== "string" || typeof content !== "string") {
      throw new Error("Arguments 'path' and 'content' must be strings");
    }
    if (logInfo) {
      logInfo(`Appending lines in: ${path}`);
    }
    try {
      const fileContent = fs.read(path);
      const fileLines = fileContent.split(/\r?\n/);
      const appendLines = content.split(/\r?\n/);

      if (!search) {
        const newLines = [...fileLines, ...appendLines];
        fs.write(path, newLines.join("\n"));
        return `OK appended to end of ${path}`;
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

      const insertIndex = matchStartIndex + searchLines.length;
      const newLines = [
        ...fileLines.slice(0, insertIndex),
        ...appendLines,
        ...fileLines.slice(insertIndex),
      ];

      fs.write(path, newLines.join("\n"));
      return `OK appended content after match in ${path}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default appendLinesTool;
