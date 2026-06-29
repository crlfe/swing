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

    it("should throw EISDIR when reading an empty path", () => {
      expect(() => files.read("")).toThrow("EISDIR");
    });

    it("should handle dot in path", () => {
      files.write("a/b.txt", "content");
      expect(files.read("a/./b.txt")).toBe("content");
    });

    it("should handle double-dot in path", () => {
      files.write("a/c.txt", "content");
      expect(files.read("a/b/../c.txt")).toBe("content");
    });

    it("should throw EISDIR when reading a directory with trailing slash", () => {
      files.write("dir/file.txt", "content");
      expect(() => files.read("dir/")).toThrow("EISDIR");
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

    it("should throw ENOTDIR when writing a directory where a file exists", () => {
      files.write("file.txt", "content");
      expect(() => files.write("file.txt/sub", "content")).toThrow("ENOTDIR");
    });

    it("should throw an error if path is empty", () => {
      expect(() => files.write("", "content")).toThrow();
    });

    it("should create deeply nested directories on write", () => {
      const result = files.write("a/b/c/d/e.txt", "nested");
      expect(result).toBe(true);
      expect(files.read("a/b/c/d/e.txt")).toBe("nested");
    });

    it("should handle double-dot in path", () => {
      files.write("a/../b.txt", "content");
      expect(files.read("b.txt")).toBe("content");
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

    it("should delete deeply nested empty directories", () => {
      files.write("a/b/c/d/e.txt", "nested");
      files.delete("a/b/c/d/e.txt");
      expect(files.delete("a/b/c/d")).toBe(true);
      expect(files.delete("a/b/c")).toBe(true);
      expect(files.delete("a/b")).toBe(true);
      expect(files.delete("a")).toBe(true);
    });

    it("should handle double-dot in path", () => {
      files.write("a/../b.txt", "content");
      expect(files.delete("a/../b.txt")).toBe(true);
      expect(files.read("b.txt")).toBeUndefined();
    });
  });

  describe("move", () => {
    it("should move a file to a new name in the same directory", () => {
      files.write("file.txt", "content");
      files.move("file.txt", "new_file.txt");
      expect(files.read("file.txt")).toBeUndefined();
      expect(files.read("new_file.txt")).toBe("content");
    });

    it("should move a file to a different directory", () => {
      files.write("dir/file.txt", "content");
      files.move("dir/file.txt", "new_dir/file.txt");
      expect(files.read("dir/file.txt")).toBeUndefined();
      expect(files.read("new_dir/file.txt")).toBe("content");
    });

    it("should move a directory to a new location", () => {
      files.write("dir/file.txt", "content");
      files.move("dir", "new_dir");
      expect(files.getNode("dir")).toBeUndefined();
      expect(files.read("new_dir/file.txt")).toBe("content");
    });

    it("should throw ENOENT when the old path does not exist", () => {
      expect(() => files.move("nonexistent", "new_path")).toThrow("ENOENT");
    });

    it("should move a file onto another file", () => {
      files.write("foo.txt", "content1");
      files.write("bar.txt", "content2");
      files.move("foo.txt", "bar.txt");
      expect(files.read("bar.txt")).toBe("content1");
    });

    it("should throw EEXIST when moving a directory onto another directory", () => {
      files.write("foo/file.txt", "content1");
      files.write("bar/bar-file.txt", "content2");
      expect(() => files.move("foo", "bar")).toThrow("EEXIST");
    });

    it("should throw EEXIST when moving a directory onto a file", () => {
      files.write("dir/file.txt", "content1");
      files.write("target.txt", "content2");
      expect(() => files.move("dir", "target.txt")).toThrow("EEXIST");
    });

    it("should move the root", () => {
      files.write("foo.txt", "content");
      files.move("", "dir");
      expect(files.read("dir/foo.txt")).toBe("content");
    });

    it("should handle dot in new path", () => {
      files.write("file.txt", "content");
      files.move("file.txt", "./file.txt");
      expect(files.read("file.txt")).toBe("content");
    });

    it("should create missing directories when moving a file", () => {
      files.write("file.txt", "content");
      files.move("file.txt", "nonexistent_dir/file.txt");
      expect(files.read("file.txt")).toBeUndefined();
      expect(files.read("nonexistent_dir/file.txt")).toBe("content");
    });

    it("should create missing parent when moving a directory into itself", () => {
      files.write("dir/file.txt", "content");
      files.move("dir", "dir/subdir");
      expect(files.read("dir/subdir/file.txt")).toBe("content");
    });

    it("should create missing parents when moving a directory under itself", () => {
      files.write("dir/subdir/file.txt", "content");
      files.move("dir", "dir/subdir/subdir");
      expect(files.read("dir/subdir/subdir/subdir/file.txt")).toBe("content");
    });

    it("should throw EEXIST when moving a file onto a directory", () => {
      files.write("dir/file.txt", "content");
      files.write("other.txt", "data");
      expect(() => files.move("other.txt", "dir")).toThrow("EEXIST");
    });

    it("should do nothing when oldPath and newPath are identical strings", () => {
      files.write("file.txt", "content");
      files.move("file.txt", "file.txt");
      expect(files.read("file.txt")).toBe("content");
    });

    it("should handle double-dot in new path", () => {
      files.write("file.txt", "content");
      files.write("dir/dummy.txt", "dummy");
      files.move("file.txt", "dir/../file.txt");
      expect(files.read("file.txt")).toBe("content");
    });
  });
});
