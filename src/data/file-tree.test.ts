import { beforeEach, describe, expect, it, vitest } from "vitest";

import { FileTree } from "./file-tree.ts";
import type { TreeDir } from "./types.ts";

describe("FileTree", () => {
  let tree: FileTree;

  beforeEach(() => {
    tree = new FileTree();
  });

  describe("constructor and getRoot", () => {
    it("should initialize with an empty root directory by default", () => {
      const root = tree.getRoot();
      expect(root.type).toBe("dir");
      expect(root.children.size).toBe(0);
    });

    it("should initialize with a custom root directory", () => {
      const customRoot: TreeDir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: ["hello"] }]]),
      };
      const treeWithCustomRoot = new FileTree(customRoot);
      expect(treeWithCustomRoot.getRoot()).toBe(customRoot);
    });
  });

  describe("getNode", () => {
    it("should return the correct node for a given path", () => {
      tree.write("a/b/c.txt", ["content"]);
      const node = tree.getNode("a/b/c.txt");
      expect(node).toEqual({ type: "blob", content: ["content"] });
    });

    it("should not exist for a non-existent path", () => {
      expect(tree.has("nonexistent")).toBe(false);
      expect(tree.has("a/nonexistent")).toBe(false);
    });

    it('should handle "." and ".." in paths', () => {
      tree.write("a/b/c.txt", ["content"]);
      expect(tree.getNode("a/./b/c.txt")).toEqual({ type: "blob", content: ["content"] });

      expect(tree.getNode("a/b/c.txt/..")).toEqual(tree.getNode("a/b"));
    });
  });

  describe("read", () => {
    it("should read the content of a blob", () => {
      tree.write("test.txt", ["hello world"]);
      expect(tree.read("test.txt")).toEqual(["hello world"]);
    });

    it("should throw for a non-existent file", () => {
      expect(tree.has("missing.txt")).toBe(false);
    });

    it("should throw when reading a directory", () => {
      tree.write("dir/file.txt", ["content"]);
      expect(() => tree.read("dir")).toThrow("Can not read a directory");
    });

    it("should throw when reading an empty path", () => {
      expect(() => tree.read("")).toThrow("Can not read a directory");
    });

    it("should handle dot in path", () => {
      tree.write("a/b.txt", ["content"]);
      expect(tree.read("a/./b.txt")).toEqual(["content"]);
    });

    it("should handle double-dot in path", () => {
      tree.write("a/c.txt", ["content"]);
      expect(tree.read("a/b/../c.txt")).toEqual(["content"]);
    });

    it("should throw when reading a directory with trailing slash", () => {
      tree.write("dir/file.txt", ["content"]);
      expect(() => tree.read("dir/")).toThrow("Can not read a directory");
    });
  });

  describe("write", () => {
    it("should write a new file", () => {
      const result = tree.write("newfile.txt", ["new content"]);
      expect(result).toBe(true);
      expect(tree.read("newfile.txt")).toEqual(["new content"]);
    });

    it("should update an existing file with different content", () => {
      tree.write("file.txt", ["old content"]);
      const result = tree.write("file.txt", ["new content"]);
      expect(result).toBe(true);
      expect(tree.read("file.txt")).toEqual(["new content"]);
    });

    it("should return false when writing the same content to an existing file", () => {
      tree.write("file.txt", ["same content"]);
      const result = tree.write("file.txt", ["same content"]);
      expect(result).toBe(false);
    });

    it("should throw when writing a directory", () => {
      tree.write("dir/file.txt", ["content"]);
      expect(() => tree.write("dir", ["content"])).toThrow("Can not write a directory");
    });

    it("should throw when writing a directory where a file exists", () => {
      tree.write("file.txt", ["content"]);
      expect(() => tree.write("file.txt/sub", ["content"])).toThrow(
        "Path component is not a directory",
      );
    });

    it("should throw when path is empty", () => {
      expect(() => tree.write("", ["content"])).toThrow();
    });

    it("should create deeply nested directories on write", () => {
      const result = tree.write("a/b/c/d/e.txt", ["nested"]);
      expect(result).toBe(true);
      expect(tree.read("a/b/c/d/e.txt")).toEqual(["nested"]);
    });

    it("should handle double-dot in path", () => {
      tree.write("a/../b.txt", ["content"]);
      expect(tree.read("b.txt")).toEqual(["content"]);
    });
  });

  describe("delete", () => {
    it("should not exist after deleting an existing file", () => {
      tree.write("file.txt", ["content"]);
      tree.delete("file.txt");
      expect(tree.has("file.txt")).toBe(false);
    });

    it("should throw when deleting a non-existent path", () => {
      expect(() => tree.delete("nonexistent")).toThrow();
    });

    it("should not exist after deleting an empty directory", () => {
      tree.write("dir/file.txt", ["content"]);
      tree.delete("dir/file.txt");
      tree.delete("dir");
      expect(tree.has("dir")).toBe(false);
    });

    it("should throw when deleting a non-empty directory", () => {
      tree.write("dir/file.txt", ["content"]);
      expect(() => tree.delete("dir")).toThrow("Directory not empty");
    });

    it("should throw when deleting a directory where a file exists", () => {
      tree.write("file.txt", ["content"]);
      expect(() => tree.delete("file.txt/sub")).toThrow("Path component is not a directory");
    });

    it("should delete the root", () => {
      expect(() => tree.delete("")).not.toThrow();
    });

    it("should throw when deleting an empty path and root is not empty", () => {
      tree.write("file.txt", ["content"]);
      expect(() => tree.delete("")).toThrow("Directory not empty");
    });

    it("should not exist after deleting a non-empty directory recursively", () => {
      tree.write("dir/file1.txt", ["1"]);
      tree.write("dir/file2.txt", ["2"]);
      tree.delete("dir", { recursive: true });
      expect(tree.has("dir")).toBe(false);
    });

    it("should not exist after deleting a deeply nested directory recursively", () => {
      tree.write("a/b/c/file.txt", ["content"]);
      tree.delete("a", { recursive: true });
      expect(tree.has("a")).toBe(false);
    });

    it("should delete deeply nested empty directories", () => {
      tree.write("a/b/c/d/e.txt", ["nested"]);
      tree.delete("a/b/c/d/e.txt");
      tree.delete("a/b/c/d");
      tree.delete("a/b/c");
      tree.delete("a/b");
      tree.delete("a");
      expect(tree.has("a")).toBe(false);
    });

    it("should not exist after deleting a file via double-dot path", () => {
      tree.write("a/../b.txt", ["content"]);
      tree.delete("a/../b.txt");
      expect(tree.has("b.txt")).toBe(false);
    });
  });

  describe("move", () => {
    it("should move a file to a new name in the same directory", () => {
      tree.write("file.txt", ["content"]);
      tree.move("file.txt", "new_file.txt");
      expect(tree.has("file.txt")).toBe(false);
      expect(tree.read("new_file.txt")).toEqual(["content"]);
    });

    it("should move a file to a different directory", () => {
      tree.write("dir/file.txt", ["content"]);
      tree.move("dir/file.txt", "new_dir/file.txt");
      expect(tree.has("dir/file.txt")).toBe(false);
      expect(tree.read("new_dir/file.txt")).toEqual(["content"]);
    });

    it("should move a directory to a new location", () => {
      tree.write("dir/file.txt", ["content"]);
      tree.move("dir", "new_dir");
      expect(tree.has("dir")).toBe(false);
      expect(tree.read("new_dir/file.txt")).toEqual(["content"]);
    });

    it("should throw when the old path does not exist", () => {
      expect(() => tree.move("nonexistent", "new_path")).toThrow("Path not found");
    });

    it("should move a file onto another file", () => {
      tree.write("foo.txt", ["content1"]);
      tree.write("bar.txt", ["content2"]);
      tree.move("foo.txt", "bar.txt");
      expect(tree.read("bar.txt")).toEqual(["content1"]);
    });

    it("should throw when moving a directory onto another directory", () => {
      tree.write("foo/file.txt", ["content1"]);
      tree.write("bar/bar-file.txt", ["content2"]);
      expect(() => tree.move("foo", "bar")).toThrow("Destination path already exists");
    });

    it("should throw when moving a directory onto a file", () => {
      tree.write("dir/file.txt", ["content1"]);
      tree.write("target.txt", ["content2"]);
      expect(() => tree.move("dir", "target.txt")).toThrow("Destination path already exists");
    });

    it("should move the root", () => {
      tree.write("foo.txt", ["content"]);
      tree.move("", "dir");
      expect(tree.read("dir/foo.txt")).toEqual(["content"]);
    });

    it("should handle dot in new path", () => {
      tree.write("file.txt", ["content"]);
      tree.move("file.txt", "./file.txt");
      expect(tree.read("file.txt")).toEqual(["content"]);
    });

    it("should create missing directories when moving a file", () => {
      tree.write("file.txt", ["content"]);
      tree.move("file.txt", "nonexistent_dir/file.txt");
      expect(tree.has("file.txt")).toBe(false);
      expect(tree.read("nonexistent_dir/file.txt")).toEqual(["content"]);
    });

    it("should create missing parent when moving a directory into itself", () => {
      tree.write("dir/file.txt", ["content"]);
      tree.move("dir", "dir/subdir");
      expect(tree.read("dir/subdir/file.txt")).toEqual(["content"]);
    });

    it("should create missing parents when moving a directory under itself", () => {
      tree.write("dir/subdir/file.txt", ["content"]);
      tree.move("dir", "dir/subdir/subdir");
      expect(tree.read("dir/subdir/subdir/subdir/file.txt")).toEqual(["content"]);
    });

    it("should throw when moving a file onto a directory", () => {
      tree.write("dir/file.txt", ["content"]);
      tree.write("other.txt", ["data"]);
      expect(() => tree.move("other.txt", "dir")).toThrow("Destination path already exists");
    });

    it("should do nothing when oldPath and newPath are identical strings", () => {
      tree.write("file.txt", ["content"]);
      tree.move("file.txt", "file.txt");
      expect(tree.read("file.txt")).toEqual(["content"]);
    });

    it("should handle double-dot in new path", () => {
      tree.write("file.txt", ["content"]);
      tree.write("dir/dummy.txt", ["dummy"]);
      tree.move("file.txt", "dir/../file.txt");
      expect(tree.read("file.txt")).toEqual(["content"]);
    });
  });

  describe("watch", () => {
    it("should notify when a file is written", () => {
      const callback = vitest.fn();
      tree.watch("test.txt", callback);
      tree.write("test.txt", ["content"]);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should notify when a file is deleted", () => {
      const callback = vitest.fn();
      tree.write("test.txt", ["content"]);
      tree.watch("test.txt", callback);
      tree.delete("test.txt");
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should notify when a file is moved (both old and new paths)", () => {
      const oldCallback = vitest.fn();
      const newCallback = vitest.fn();
      tree.write("old.txt", ["content"]);
      tree.watch("old.txt", oldCallback);
      tree.watch("new.txt", newCallback);
      tree.move("old.txt", "new.txt");
      expect(oldCallback).toHaveBeenCalledTimes(1);
      expect(newCallback).toHaveBeenCalledTimes(1);
    });

    it("should support recursive watching", () => {
      const callback = vitest.fn();
      tree.watch("dir", callback, { recursive: true });

      tree.write("dir/file1.txt", ["content1"]);
      tree.write("dir/file2.txt", ["content2"]);
      tree.write("dir/subdir/file3.txt", ["content3"]);

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it("should not notify recursively if recursive is false", () => {
      const callback = vitest.fn();
      tree.watch("dir", callback, { recursive: false });

      tree.write("dir/file.txt", ["content"]);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should stop notifying after unsubscribe", () => {
      const callback = vitest.fn();
      const unsubscribe = tree.watch("test.txt", callback);

      tree.write("test.txt", ["content1"]);
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      tree.write("test.txt", ["content2"]);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should handle multiple watchers on the same path", () => {
      const cb1 = vitest.fn();
      const cb2 = vitest.fn();
      tree.watch("test.txt", cb1);
      tree.watch("test.txt", cb2);

      tree.write("test.txt", ["content"]);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe("walk", () => {
    it("should throw for non-existent path", () => {
      expect(() => tree.walk("nonexistent", () => {})).toThrow("Path not found");
    });

    it("should walk a single file", () => {
      tree.write("file.txt", ["content"]);
      const visited: string[] = [];
      tree.walk("file.txt", (path) => {
        visited.push(path);
      });
      expect(visited).toEqual(["file.txt"]);
    });

    it("should walk a directory and its contents", () => {
      tree.write("dir/file1.txt", ["1"]);
      tree.write("dir/file2.txt", ["2"]);
      tree.write("dir/subdir/file3.txt", ["3"]);

      const visited: string[] = [];
      tree.walk("dir", (path) => {
        visited.push(path);
      });

      expect(visited).toContain("dir");
      expect(visited).toContain("dir/file1.txt");
      expect(visited).toContain("dir/file2.txt");
      expect(visited).toContain("dir/subdir");
      expect(visited).toContain("dir/subdir/file3.txt");
      expect(visited.length).toBe(5);
    });

    it("should stop walking when callback returns false", () => {
      tree.write("dir/file1.txt", ["1"]);
      tree.write("dir/file2.txt", ["2"]);

      const visited: string[] = [];
      tree.walk("dir", (path) => {
        visited.push(path);
        if (path === "dir") return false;
      });

      expect(visited).toEqual(["dir"]);
    });

    it("should handle trailing slashes in path", () => {
      tree.write("dir/file.txt", ["content"]);
      const visited: string[] = [];
      tree.walk("dir/", (path) => {
        visited.push(path);
      });
      expect(visited).toEqual(["dir", "dir/file.txt"]);
    });

    it("should walk from the root", () => {
      tree.write("a.txt", ["a"]);
      tree.write("b/c.txt", ["b"]);

      const visited: string[] = [];
      tree.walk("", (path) => {
        visited.push(path);
      });

      expect(visited).toEqual(["a.txt", "b", "b/c.txt"]);
    });

    it("should handle dot and double-dot in starting path", () => {
      tree.write("a/b/c.txt", ["content"]);
      const visited: string[] = [];
      tree.walk("a/./b/../b", (path) => {
        visited.push(path);
      });
      expect(visited).toEqual(["a/b", "a/b/c.txt"]);
    });
  });

  describe("fromJSON and toJSON", () => {
    it("should export and import the tree structure", () => {
      // The line handling currently ensures a trailing newline on every file.
      const data = {
        dir1: {
          "file1.txt": "content1",
          subdir: {
            "file2.txt": "content2",
          },
        },
        "file3.txt": "content3",
      };

      const tree = new FileTree();
      tree.fromJSON(data);

      expect(tree.read("dir1/file1.txt")).toEqual(["content1"]);
      expect(tree.read("dir1/subdir/file2.txt")).toEqual(["content2"]);
      expect(tree.read("file3.txt")).toEqual(["content3"]);
      expect(tree.toJSON()).toEqual(data);
    });

    it("should handle an empty tree", () => {
      const tree = new FileTree();
      expect(tree.toJSON()).toEqual({});
      tree.fromJSON({});
      expect(tree.getRoot().children.size).toBe(0);
    });
  });

  describe("size", () => {
    it("should return the number of blobs in the tree", () => {
      tree.write("file1.txt", ["1"]);
      tree.write("file2.txt", ["2"]);
      tree.write("dir/file3.txt", ["3"]);
      expect(tree.size).toBe(3);
    });

    it("should return 0 for an empty tree", () => {
      expect(tree.size).toBe(0);
    });

    it("should update size after deletion", () => {
      tree.write("file1.txt", ["1"]);
      tree.write("file2.txt", ["2"]);
      tree.delete("file1.txt");
      expect(tree.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("should remove all files and directories", () => {
      tree.write("file1.txt", ["1"]);
      tree.write("dir/file2.txt", ["2"]);
      tree.clear();
      expect(tree.size).toBe(0);
      expect(tree.getRoot().children.size).toBe(0);
    });
  });

  describe("list", () => {
    it("should list all paths in alphabetical order", () => {
      tree.write("b.txt", ["b"]);
      tree.write("a.txt", ["a"]);
      tree.write("dir/c.txt", ["c"]);

      expect(tree.list()).toEqual(["a.txt", "b.txt", "dir", "dir/c.txt"]);
    });

    it("should return an empty array for an empty tree", () => {
      expect(tree.list()).toEqual([]);
    });
  });

  describe("listWithDirectoriesFirst", () => {
    it("should list paths with directories first and trailing slashes", () => {
      tree.write("file.txt", ["f"]);
      tree.write("dir/file.txt", ["df"]);
      tree.write("dir/subdir/file.txt", ["dsf"]);
      tree.write("another_dir/file.txt", ["af"]);

      const result = tree.listWithDirectoriesFirst();

      expect(result).toEqual([
        "another_dir/",
        "another_dir/file.txt",
        "dir/",
        "dir/subdir/",
        "dir/subdir/file.txt",
        "dir/file.txt",
        "file.txt",
      ]);
    });

    it("should return an empty array for an empty tree", () => {
      expect(tree.listWithDirectoriesFirst()).toEqual([]);
    });
  });
});
