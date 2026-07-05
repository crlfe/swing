import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import appendLinesTool from "./append_lines.ts";
import deleteFileTool from "./delete_file.ts";
import forgetTool from "./forget.ts";
import insertLinesTool from "./insert_lines.ts";
import listFilesTool from "./list_files.ts";
import moveFileTool from "./move_file.ts";
import openFileTool from "./open_file.ts";
import readFileTool from "./read_file.ts";
import replaceLinesTool from "./replace_lines.ts";
import searchFilesTool from "./search_files.ts";
import writeFileTool from "./write_file.ts";

describe("Tools", () => {
  let config: ChatConfig;
  let fs: FileTree;

  beforeEach(() => {
    config = {
      url: "",
      model: "",
      key: "",

      fs: new FileTree(),
      context: new ChatContext(),
      logText(_: string) {},
      logInfo(_: string) {},
      logThink(_: string) {},
    };
    fs = config.fs;
  });

  describe("list_files", () => {
    it("should list files in the root directory", async () => {
      fs.write("file1.txt", ["1"]);
      fs.write("dir1/file2.txt", ["2"]);

      const result = await listFilesTool.execute({ path: "" }, config);
      expect(result).toContain("file1.txt");
      expect(result).toContain("dir1/");
    });

    it("should list files in a subdirectory", async () => {
      fs.write("dir1/file2.txt", ["2"]);
      fs.write("dir1/file3.txt", ["3"]);

      const result = await listFilesTool.execute({ path: "dir1" }, config);
      expect(result).toContain("file2.txt");
      expect(result).toContain("file3.txt");
    });

    it("should return error for non-existent path", async () => {
      await expect(listFilesTool.execute({ path: "ghost" }, config)).rejects.toThrow(
        "Path not found",
      );
    });

    it("should return error if path is a file", async () => {
      fs.write("file1.txt", ["1"]);
      await expect(listFilesTool.execute({ path: "file1.txt" }, config)).rejects.toThrow(
        "Path is not a directory",
      );
    });
  });

  describe("read_file", () => {
    it("should read a file's content", async () => {
      fs.write("test.txt", ["hello world"]);
      const result = await readFileTool.execute({ path: "test.txt" }, config);
      expect(result).toContain("read test.txt\nhello world");
    });

    it("should return error for non-existent file", async () => {
      await expect(readFileTool.execute({ path: "ghost.txt" }, config)).rejects.toThrow(
        "Path not found",
      );
    });
  });

  describe("write_file", () => {
    it("should write content to a file", async () => {
      const result = await writeFileTool.execute({ path: "new.txt", content: "content" }, config);
      expect(result).toBe("wrote new.txt");
      expect(fs.read("new.txt")).toEqual(["content"]);
    });

    it("should overwrite existing file", async () => {
      fs.write("test.txt", ["old"]);
      await writeFileTool.execute({ path: "test.txt", content: "new" }, config);
      expect(fs.read("test.txt")).toEqual(["new"]);
    });
  });

  describe("replace_lines", () => {
    it("should replace a string in a file", async () => {
      fs.write("test.txt", ["Hello World", "This is a test"]);
      const result = await replaceLinesTool.execute(
        {
          path: "test.txt",
          search: "Hello World",
          replace: "Hello Vitest",
        },
        config,
      );

      expect(result).toContain("edited");
      expect(fs.read("test.txt")).toEqual(["Hello Vitest", "This is a test"]);
    });

    it("should be resilient to indentation (trimmed match)", async () => {
      fs.write("test.ts", ["function test() {", "  console.log('hi');", "}"]);
      const result = await replaceLinesTool.execute(
        {
          path: "test.ts",
          search: "console.log('hi');",
          replace: "  console.log('hello');",
        },
        config,
      );

      expect(result).toContain("edited");
      expect(fs.read("test.ts")).toEqual(["function test() {", "  console.log('hello');", "}"]);
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", ["Hello World"]);
      await expect(
        replaceLinesTool.execute(
          {
            path: "test.txt",
            search: "Ghost",
            replace: "Found",
          },
          config,
        ),
      ).rejects.toThrow("Search string not found");
    });
  });

  describe("append_lines", () => {
    it("should append to the end of a file when no search is provided", async () => {
      fs.write("test.txt", ["line 1"]);
      const result = await appendLinesTool.execute(
        {
          path: "test.txt",
          content: "line 2",
        },
        config,
      );
      expect(result).toContain("appended to end");
      expect(fs.read("test.txt")).toEqual(["line 1", "line 2"]);
    });

    it("should append after a search string", async () => {
      fs.write("test.txt", ["start", "middle", "end"]);
      const result = await appendLinesTool.execute(
        {
          path: "test.txt",
          content: "inserted",
          search: "middle",
        },
        config,
      );
      expect(result).toContain("appended content after match");
      expect(fs.read("test.txt")).toEqual(["start", "middle", "inserted", "end"]);
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", ["hello"]);
      await expect(
        appendLinesTool.execute(
          {
            path: "test.txt",
            content: "world",
            search: "ghost",
          },
          config,
        ),
      ).rejects.toThrow("Search string not found");
    });
  });

  describe("insert_lines", () => {
    it("should insert at the beginning when no search is provided", async () => {
      fs.write("test.txt", ["line 2"]);
      const result = await insertLinesTool.execute(
        {
          path: "test.txt",
          content: "line 1",
        },
        config,
      );
      expect(result).toContain("inserted at beginning");
      expect(fs.read("test.txt")).toEqual(["line 1", "line 2"]);
    });

    it("should insert before a search string", async () => {
      fs.write("test.txt", ["start", "middle", "end"]);
      const result = await insertLinesTool.execute(
        {
          path: "test.txt",
          content: "inserted",
          search: "middle",
        },
        config,
      );
      expect(result).toContain("inserted content before match");
      expect(fs.read("test.txt")).toEqual(["start", "inserted", "middle", "end"]);
    });

    it("should return error if search string not found", async () => {
      fs.write("test.txt", ["hello"]);
      await expect(
        insertLinesTool.execute(
          {
            path: "test.txt",
            content: "world",
            search: "ghost",
          },
          config,
        ),
      ).rejects.toThrow("Search string not found");
    });
  });

  describe("delete_file", () => {
    it("should delete a file", async () => {
      fs.write("delete-me.txt", ["bye"]);
      const result = await deleteFileTool.execute({ path: "delete-me.txt" }, config);
      expect(result).toBe("deleted delete-me.txt");
      expect(fs.has("delete-me.txt")).toBe(false);
    });

    it("should return error for non-existent file", async () => {
      await expect(deleteFileTool.execute({ path: "ghost.txt" }, config)).rejects.toThrow(
        "Path not found",
      );
    });
  });

  describe("move_file", () => {
    it("should move/rename a file", async () => {
      fs.write("old.txt", ["content"]);
      const result = await moveFileTool.execute({ oldPath: "old.txt", newPath: "new.txt" }, config);
      expect(result).toBe("moved old.txt to new.txt");
      expect(fs.read("new.txt")).toEqual(["content"]);
      expect(fs.has("old.txt")).toBe(false);
    });

    it("should return error if destination exists", async () => {
      fs.write("f1.txt", ["1"]);
      fs.write("f2.txt", ["2"]);
      await expect(
        moveFileTool.execute({ oldPath: "f1.txt", newPath: "f2.txt" }, config),
      ).rejects.toThrow("Destination already exists");
    });
  });

  describe("search_files", () => {
    it("should find files containing the query", async () => {
      fs.write("f1.txt", ["apple pie"]);
      fs.write("f2.txt", ["banana cake"]);
      fs.write("f3.txt", ["apple tart"]);

      const result = await searchFilesTool.execute({ query: "apple" }, config);
      expect(result).toContain("f1.txt");
      expect(result).toContain("f3.txt");
      expect(result).not.toContain("f2.txt");
    });

    it("should return no results if query not found", async () => {
      fs.write("f1.txt", ["apple"]);
      const result = await searchFilesTool.execute({ query: "orange" }, config);
      expect(result).toContain("search found no results");
    });
  });

  describe("open_file", () => {
    it("should open a file and return its content", async () => {
      fs.write("open.txt", ["hello open"]);
      const result = await openFileTool.execute({ path: "open.txt" }, config, "call-1");
      expect(result).toContain("open open.txt\nhello open");
    });

    it("should return error for non-existent file", async () => {
      await expect(openFileTool.execute({ path: "ghost.txt" }, config, "call-2")).rejects.toThrow(
        "Path not found",
      );
    });

    it("should return error for too large file", async () => {
      fs.write("large.txt", ["a".repeat(100001)]);
      await expect(openFileTool.execute({ path: "large.txt" }, config, "call-3")).rejects.toThrow(
        "File large.txt is too large to open",
      );
    });

    it("should update content when file changes", async () => {
      fs.write("live.txt", ["v1"]);

      config.context.addMessage({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call-4", type: "function", function: { name: "test_tool", arguments: "{}" } },
        ],
      });

      const result = await openFileTool.execute({ path: "live.txt" }, config, "call-4");
      config.context.addMessage({
        role: "tool",
        tool_call_id: "call-4",
        content: result,
      });
      expect(result).toContain("v1");

      // Simulate file change
      fs.write("live.txt", ["v2"]);

      const updatedResult = config.context.getToolResult("call-4");
      expect(updatedResult).toContain("v2");
    });
  });

  describe("forget", () => {
    it("should remove a tool call from context", async () => {
      config.context.addMessage({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call-99", type: "function", function: { name: "test_tool", arguments: "{}" } },
        ],
      });
      config.context.addMessage({
        role: "tool",
        tool_call_id: "call-99",
        content: "test result",
      });

      const result = await forgetTool.execute({ toolCallId: "call-99" }, config);
      expect(result).toBe("forgotten tool call call-99");
      expect(config.context.getToolResult("call-99")).toBeUndefined();
    });

    it("should return error if toolCallId is missing or invalid", async () => {
      await expect(forgetTool.execute({ toolCallId: "non-existent" }, config)).rejects.toThrow(
        "Tool call not found",
      );
    });
  });
});
