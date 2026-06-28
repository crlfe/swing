import { beforeEach, describe, expect, it } from "vitest";

import { Files, type Dir } from "./files.ts";

describe("Files", () => {
  let files: Files;

  beforeEach(() => {
    files = new Files();
  });

  describe("constructor and getRoot", () => {
    it("should initialize with an empty root directory by default", () => {
      const root = files.getRoot();
      expect(root.type).toBe("dir");
      expect(root.children.size).toBe(0);
    });

    it("should initialize with a custom root directory", () => {
      const customRoot: Dir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: "hello" }]]),
      };
      const filesWithCustomRoot = new Files(customRoot);
      expect(filesWithCustomRoot.getRoot()).toBe(customRoot);
    });
  });

  describe("getNode", () => {
    it("should return the correct node for a given path", () => {
      files.write("a/b/c.txt", "content");
      const node = files.getNode("a/b/c.txt");
      expect(node).toEqual({ type: "blob", content: "content" });
    });

    it("should return undefined for a non-existent path", () => {
      expect(files.getNode("nonexistent")).toBeUndefined();
      expect(files.getNode("a/nonexistent")).toBeUndefined();
    });

    it('should handle "." and ".." in paths', () => {
      files.write("a/b/c.txt", "content");
      expect(files.getNode("a/./b/c.txt")).toEqual({ type: "blob", content: "content" });

      // splitPath('a/b/c.txt/..') -> ['a', 'b']
      // node starts as root.
      // 'a' -> node is 'a' (dir)
      // 'b' -> node is 'b' (dir)
      // result is node 'b'.
      expect(files.getNode("a/b/c.txt/..")).toEqual(files.getNode("a/b"));
    });
  });

  describe("read", () => {
    it("should read the content of a blob", () => {
      files.write("test.txt", "hello world");
      expect(files.read("test.txt")).toBe("hello world");
    });

    it("should return undefined for a non-existent file", () => {
      expect(files.read("missing.txt")).toBeUndefined();
    });

    it("should throw EISDIR when reading a directory", () => {
      files.write("dir/file.txt", "content");
      expect(() => files.read("dir")).toThrow("EISDIR");
    });
  });

  describe("write", () => {
    it("should write a new file", () => {
      const result = files.write("newfile.txt", "new content");
      expect(result).toBe(true);
      expect(files.read("newfile.txt")).toBe("new content");
    });

    it("should update an existing file with different content", () => {
      files.write("file.txt", "old content");
      const result = files.write("file.txt", "new content");
      expect(result).toBe(true);
      expect(files.read("file.txt")).toBe("new content");
    });

    it("should return false when writing the same content to an existing file", () => {
      files.write("file.txt", "same content");
      const result = files.write("file.txt", "same content");
      expect(result).toBe(false);
    });

    it("should throw EISDIR when writing a directory", () => {
      files.write("dir/file.txt", "content");
      expect(() => files.write("dir", "content")).toThrow("EISDIR");
    });

    it("should throw ENOTDIR when writing a file where a directory exists", () => {
      files.write("file.txt", "content");
      expect(() => files.write("file.txt/sub", "content")).toThrow("ENOTDIR");
    });

    it("should throw an error if path is empty", () => {
      expect(() => files.write("", "content")).toThrow();
    });
  });

  describe("delete", () => {
    it("should delete an existing file", () => {
      files.write("file.txt", "content");
      const result = files.delete("file.txt");
      expect(result).toBe(true);
      expect(files.getNode("file.txt")).toBeUndefined();
    });

    it("should return false when deleting a non-existent path", () => {
      expect(files.delete("nonexistent")).toBe(false);
    });

    it("should delete an empty directory", () => {
      files.write("dir/file.txt", "content");
      files.delete("dir/file.txt");
      const result = files.delete("dir");
      expect(result).toBe(true);
      expect(files.getNode("dir")).toBeUndefined();
    });

    it("should throw ENOTEMPTY when deleting a non-empty directory", () => {
      files.write("dir/file.txt", "content");
      expect(() => files.delete("dir")).toThrow("ENOTEMPTY");
    });

    it("should throw ENOTDIR when deleting a directory where a file exists", () => {
      files.write("file.txt", "content");
      expect(() => files.delete("file.txt/sub")).toThrow("ENOTDIR");
    });

    it("should throw an error if path is empty", () => {
      expect(() => files.delete("")).toThrow();
    });
  });
});
