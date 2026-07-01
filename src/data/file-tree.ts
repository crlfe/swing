import type { Blob, Dir } from "./types.ts";

export type FileTreeListener = (path: string) => void;

interface FileTreeWatch {
  callback: FileTreeListener;
  recursive: boolean;
}

export class FileTree {
  #root: Dir;
  #watchers: Map<string, Set<FileTreeWatch>> = new Map();

  constructor(root?: Dir) {
    this.#root = root ?? { type: "dir", children: new Map() };
  }

  getRoot() {
    return this.#root;
  }

  getNode(path: string): Dir | Blob | undefined {
    return walkDown(this.#root, splitPath(path))[1];
  }

  watch(
    path: string,
    callback: FileTreeListener,
    options: { recursive?: boolean } = {},
  ): () => void {
    let watchers = this.#watchers.get(path);
    if (!watchers) {
      watchers = new Set();
      this.#watchers.set(path, watchers);
    }
    const watcher = { callback, recursive: options.recursive ?? false };
    watchers.add(watcher);

    return () => {
      watchers.delete(watcher);
      if (watchers.size === 0) {
        this.#watchers.delete(path);
      }
    };
  }

  read(path: string): ReadonlyArray<string> | undefined {
    const node = this.getNode(path);
    if (node?.type === "dir") {
      throw new Error("EISDIR");
    }
    return node?.content;
  }

  write(path: string, content: ReadonlyArray<string>): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error("EINVAL");
    }

    const [dirs, oldNode] = walkDown(this.#root, parts);

    if (oldNode?.type === "dir") {
      // Can not replace a dir with a blob.
      throw new Error("EISDIR");
    }

    if (oldNode?.type === "blob") {
      if (
        oldNode.content.length === content.length &&
        oldNode.content.every((line, idx) => line === content[idx])
      ) {
        // Nothing is changing.
        return false;
      }
    }

    // Walk up the tree creating updated nodes.
    let node: Dir | Blob = { type: "blob", content };
    for (let i = parts.length - 1; i >= 0; i--) {
      const children = new Map(dirs[i]?.children);
      children.set(parts[i], node);
      node = { type: "dir", children };
    }
    if (node?.type !== "dir") {
      throw new Error("EASSERT");
    }

    this.#root = node;
    this.#notifyWatchers(path);
    return true;
  }

  delete(path: string): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error("EINVAL");
    }

    const [dirs, oldNode] = walkDown(this.#root, parts);

    if (oldNode?.type === "dir" && oldNode.children.size) {
      // Can not delete a non-empty directory.
      throw new Error("ENOTEMPTY");
    }

    if (!oldNode) {
      // Nothing is changing.
      return false;
    }

    // Walk up the tree clearing out the deleted node.
    let node: Dir | undefined;
    for (let i = parts.length - 1; i >= 0; i--) {
      const children = new Map(dirs[i]?.children);
      if (node) {
        children.set(parts[i], node);
      } else {
        children.delete(parts[i]);
      }
      node = { type: "dir", children };
    }

    if (node?.type !== "dir") {
      throw new Error("EASSERT");
    }

    this.#root = node;
    this.#notifyWatchers(path);
    return true;
  }

  move(oldPath: string, newPath: string): void {
    if (oldPath === newPath) {
      // Nothing is changing.
      return;
    }

    const oldParts = splitPath(oldPath);

    const [oldDirs, oldNode] = walkDown(this.#root, oldParts);
    if (!oldNode) {
      throw new Error("ENOENT");
    }

    // Walk up the tree clearing out the deleted node.
    let node: Dir | undefined;
    for (let i = oldParts.length - 1; i >= 0; i--) {
      const children = new Map(oldDirs[i]?.children);
      if (node) {
        children.set(oldParts[i], node);
      } else {
        children.delete(oldParts[i]);
      }
      node = { type: "dir", children };
    }
    if (!oldParts.length) {
      node = { type: "dir", children: new Map() };
    }

    if (node?.type !== "dir") {
      throw new Error("EASSERT");
    }

    const newParts = splitPath(newPath);
    const [newDirs, newNode] = walkDown(node, newParts);

    if (newNode && (newNode.type !== "blob" || oldNode.type !== "blob")) {
      // Can move a blob on top of another blob, but other combinations fail.
      throw new Error("EEXIST");
    }

    // Walk up the tree creating updated nodes.
    let node2: Dir | Blob = oldNode;
    for (let i = newParts.length - 1; i >= 0; i--) {
      const children = new Map(newDirs[i]?.children);
      children.set(newParts[i], node2);
      node2 = { type: "dir", children };
    }
    if (node2?.type !== "dir") {
      throw new Error("EASSERT");
    }

    this.#root = node2;
    this.#notifyWatchers(oldPath);
    this.#notifyWatchers(newPath);
  }

  #notifyWatchers(path: string) {
    const parts = splitPath(path);
    for (const [watchPath, callbacks] of this.#watchers) {
      const watchParts = splitPath(watchPath);
      for (const { callback, recursive } of callbacks) {
        if (recursive) {
          if (
            parts.length >= watchParts.length &&
            parts.slice(0, watchParts.length).every((p, i) => p === watchParts[i])
          ) {
            callback(path);
          }
        } else {
          if (parts.length === watchParts.length && parts.every((p, i) => p === watchParts[i])) {
            callback(path);
          }
        }
      }
    }
  }
}

function splitPath(path: string): string[] {
  const dst: string[] = [];
  for (const name of path.split("/")) {
    if (!name || name === ".") {
      // Nothing to do.
    } else if (name === "..") {
      dst.pop();
    } else {
      dst.push(name);
    }
  }
  return dst;
}

function walkDown(root: Dir, parts: string[]): [Dir[], Dir | Blob | undefined] {
  const dirs: Dir[] = [];

  let node: Dir | Blob | undefined = root;
  for (const name of parts) {
    if (node?.type === "blob") {
      throw new Error("ENOTDIR");
    }
    if (node?.type === "dir") {
      dirs.push(node);
      node = node.children.get(name);
    }
  }

  return [dirs, node];
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe("splitPath", () => {
    it("should return an empty array for an empty string", () => {
      expect(splitPath("")).toEqual([]);
    });

    it("should strip single dots from path", () => {
      expect(splitPath("a/./b/./c")).toEqual(["a", "b", "c"]);
    });

    it("should resolve double-dots correctly", () => {
      expect(splitPath("a/../b/../c")).toEqual(["c"]);
    });

    it("should handle deep double-dots that go past root", () => {
      expect(splitPath("../../../foo")).toEqual(["foo"]);
    });

    it("should handle a mix of dots and double-dots", () => {
      expect(splitPath("a/./b/../c")).toEqual(["a", "c"]);
    });

    it("should handle a path with only double-dots", () => {
      expect(splitPath("../../")).toEqual([]);
    });

    it("should ignore trailing slashes", () => {
      expect(splitPath("a/b/")).toEqual(["a", "b"]);
    });

    it("should ignore leading slashes", () => {
      expect(splitPath("/a/b")).toEqual(["a", "b"]);
    });

    it("should handle multiple slashes", () => {
      expect(splitPath("a//b///c")).toEqual(["a", "b", "c"]);
    });

    it("should return empty array for root slash", () => {
      expect(splitPath("/")).toEqual([]);
    });
  });

  describe("walkDown", () => {
    it("should return root and undefined when no parts", () => {
      const root: Dir = { type: "dir", children: new Map() };
      const [dirs, node] = walkDown(root, []);
      expect(dirs).toEqual([root]);
      expect(node).toBeUndefined();
    });

    it("should throw ENOTDIR when a blob is in the path", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
      };
      expect(() => walkDown(root, ["file.txt", "sub"])).toThrow("ENOTDIR");
    });

    it("should return undefined node when path ends at a directory", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["dir", { type: "dir", children: new Map() }]]),
      };
      const [dirs, node] = walkDown(root, ["dir"]);
      expect(dirs).toEqual([root]);
      expect(node).toBeUndefined();
    });
  });
}
