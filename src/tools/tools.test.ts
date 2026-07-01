import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { Files } from "../fs.ts";
import appendLinesTool from "./append_lines.ts";
import deleteFileTool from "./delete_file.ts";
import insertLinesTool from "./insert_lines.ts";
import listFilesTool from "./list_files.ts";
import moveFileTool from "./move_file.ts";
import readFileTool from "./read_file.ts";
import replaceLinesTool from "./replace_lines.ts";
import searchFilesTool from "./search_files.ts";
import writeFileTool from "./write_file.ts";

describe("Tools", () => {
  let config: ChatConfig;
  let fs: Files;

  beforeEach(() => {
    config = {
      url: "",
      model: "",
      key: "",

      fs: new Files(),
      logText(_: string) {},
      logInfo(_: string) {},
    };
    fs = config.fs;
  });

  describe("list_files", () => {
    it("should list files in the root directory", async () => {
      fs.write("file1.txt", "1");
      fs.write("dir1/file2.txt", "2");

      const result = await listFilesTool.execute({ path: "" }, config);
      expect(result).toContain("file1.txt");
      expect(result).toContain("dir1/");
    });

    it("should list files in a subdirectory", async () => {
      fs.write("dir1/file2.txt", "2");
      fs.write("dir1/file3.txt", "3");

      const result = await listFilesTool.execute({ path: "dir1" }, config);
      expect(result).toContain("file2.txt");
      expect(result).toContain("file3.txt");
    });

    it("should return error for non-existent path", async () => {
      const result = await listFilesTool.execute({ path: "ghost" }, config);
      expect(result).toContain("ERR Path not found");
    });

    it("should return error if path is a file", async () => {
      fs.write("file1.txt", "1");
      const result = await listFilesTool.execute({ path: "file1.txt" }, config);
      expect(result).toContain("ERR Path is not a directory");
    });
  });

  describe("read_file", () => {
    it("should read a file's content", async () => {
      fs.write("test.txt", "hello world");
      const result = await readFileTool.execute({ path: "test.txt" }, config);
      expect(result).toContain("OK read test.txt\nhello world");
    });

    it("should return error for non-existent file", async () => {
      const result = await readFileTool.execute({ path: "ghost.txt" }, config);
      expect(result).toContain("ERR File not found");
    });
  });

  describe("write_file", () => {
    it("should write content to a file", async () => {
      const result = await writeFileTool.execute({ path: "new.txt", content: "content" }, config);
      expect(result).toBe("OK wrote new.txt");
      expect(fs.read("new.txt")).toBe("content");
    });

    it("should overwrite existing file", async () => {
      fs.write("test.txt", "old");
      await writeFileTool.execute({ path: "test.txt", content: "new" }, config);
      expect(fs.read("test.txt")).toBe("new");
    });
  });

  describe("replace_lines", () => {
    it("should replace a string in a file", async () => {
      fs.write("test.txt", "Hello World\nThis is a test");
      const result = await replaceLinesTool.execute(
        {
          path: "test.txt",
          search: "Hello World",
          replace: "Hello Vitest",
        },
        config,
      );

      expect(result).toContain("OK edited");
      expect(fs.read("test.txt")).toBe("Hello Vitest\nThis is a test");
    });

    it("should be resilient to indentation (trimmed match)", async () => {
      fs.write("test.ts", "function test() {\n  console.log('hi');\n}");
      const result = await replaceLinesTool.execute(
        {
          path: "test.ts",
          search: "console.log('hi');",
          replace: "  console.log('hello');",
        },
        config,
      );

      expect(result).toContain("OK edited");
      expect(fs.read("test.ts")).toBe("function test() {\n  console.log('hello');\n}");
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", "Hello World");
      const result = await replaceLinesTool.execute(
        {
          path: "test.txt",
          search: "Ghost",
          replace: "Found",
        },
        config,
      );
      expect(result).toContain("ERR Search string not found");
    });
  });

  describe("append_lines", () => {
    it("should append to the end of a file when no search is provided", async () => {
      fs.write("test.txt", "line 1");
      const result = await appendLinesTool.execute(
        {
          path: "test.txt",
          content: "line 2",
        },
        config,
      );
      expect(result).toContain("OK appended to end");
      expect(fs.read("test.txt")).toBe("line 1\nline 2");
    });

    it("should append after a search string", async () => {
      fs.write("test.txt", "start\nmiddle\nend");
      const result = await appendLinesTool.execute(
        {
          path: "test.txt",
          content: "inserted",
          search: "middle",
        },
        config,
      );
      expect(result).toContain("OK appended content after match");
      expect(fs.read("test.txt")).toBe("start\nmiddle\ninserted\nend");
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", "hello");
      const result = await appendLinesTool.execute(
        {
          path: "test.txt",
          content: "world",
          search: "ghost",
        },
        config,
      );
      expect(result).toContain("ERR Search string not found");
    });
  });

  describe("insert_lines", () => {
    it("should insert at the beginning when no search is provided", async () => {
      fs.write("test.txt", "line 2");
      const result = await insertLinesTool.execute(
        {
          path: "test.txt",
          content: "line 1",
        },
        config,
      );
      expect(result).toContain("OK inserted at beginning");
      expect(fs.read("test.txt")).toBe("line 1\nline 2");
    });

    it("should insert before a search string", async () => {
      fs.write("test.txt", "start\nmiddle\nend");
      const result = await insertLinesTool.execute(
        {
          path: "test.txt",
          content: "inserted",
          search: "middle",
        },
        config,
      );
      expect(result).toContain("OK inserted content before match");
      expect(fs.read("test.txt")).toBe("start\ninserted\nmiddle\nend");
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", "hello");
      const result = await insertLinesTool.execute(
        {
          path: "test.txt",
          content: "world",
          search: "ghost",
        },
        config,
      );
      expect(result).toContain("ERR Search string not found");
    });
  });

  describe("delete_file", () => {
    it("should delete a file", async () => {
      fs.write("delete-me.txt", "bye");
      const result = await deleteFileTool.execute({ path: "delete-me.txt" }, config);
      expect(result).toBe("OK deleted delete-me.txt");
      expect(() => fs.read("delete-me.txt")).toThrow();
    });

    it("should return error for non-existent file", async () => {
      const result = await deleteFileTool.execute({ path: "ghost.txt" }, config);
      expect(result).toContain("ERR File not found");
    });
  });

  describe("move_file", () => {
    it("should move/rename a file", async () => {
      fs.write("old.txt", "content");
      const result = await moveFileTool.execute({ oldPath: "old.txt", newPath: "new.txt" }, config);
      expect(result).toBe("OK moved old.txt to new.txt");
      expect(fs.read("new.txt")).toBe("content");
      expect(() => fs.read("old.txt")).toThrow();
    });

    it("should return error if destination exists", async () => {
      fs.write("f1.txt", "1");
      fs.write("f2.txt", "2");
      const result = await moveFileTool.execute({ oldPath: "f1.txt", newPath: "f2.txt" }, config);
      expect(result).toContain("ERR Destination already exists");
    });
  });

  describe("search_files", () => {
    it("should find files containing the query", async () => {
      fs.write("f1.txt", "apple pie");
      fs.write("f2.txt", "banana cake");
      fs.write("f3.txt", "apple tart");

      const result = await searchFilesTool.execute({ query: "apple" }, config);
      expect(result).toContain("f1.txt");
      expect(result).toContain("f3.txt");
      expect(result).not.toContain("f2.txt");
    });

    it("should return no results if query not found", async () => {
      fs.write("f1.txt", "apple");
      const result = await searchFilesTool.execute({ query: "orange" }, config);
      expect(result).toContain("OK search found no results");
    });
  });
});
