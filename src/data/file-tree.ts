import { arrayGet } from "../util.ts";
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

    const [newRoot, oldNode] = attachNode(this.#root, parts, { type: "blob", content });

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

    this.#root = newRoot;
    this.#notifyWatchers(path);
    return true;
  }

  delete(path: string): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error("EINVAL");
    }

    const [newRoot, oldNode] = detachNode(this.#root, parts);

    if (oldNode?.type === "dir" && oldNode.children.size) {
      // Can not delete a non-empty directory.
      throw new Error("ENOTEMPTY");
    }

    if (!oldNode) {
      // Nothing is changing.
      return false;
    }

    this.#root = newRoot;
    this.#notifyWatchers(path);
    return true;
  }

  move(oldPath: string, newPath: string): void {
    if (oldPath === newPath) {
      // Nothing is changing.
      return;
    }

    const oldParts = splitPath(oldPath);
    const [movingRoot, movingNode] = detachNode(this.#root, oldParts);
    if (!movingNode) {
      throw new Error("ENOENT");
    }

    const newParts = splitPath(newPath);
    const [newRoot, replacedNode] = attachNode(movingRoot, newParts, movingNode);

    if (replacedNode && (replacedNode.type !== "blob" || movingNode.type !== "blob")) {
      // Can move a blob on top of another blob, but other combinations fail.
      throw new Error("EEXIST");
    }

    this.#root = newRoot;
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

function detachNode(root: Dir, parts: string[]): [Dir, Dir | Blob | undefined] {
  const [dirs, oldNode] = walkDown(root, parts);
  if (!oldNode) {
    // Nothing changed.
    return [root, undefined];
  }

  let newNode: Dir | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = arrayGet(dirs, i);
    const part = arrayGet(parts, i);

    const children = new Map(dir.children);
    if (newNode) {
      children.set(part, newNode);
    } else {
      children.delete(part);
    }
    newNode = { type: "dir", children };
  }
  if (!newNode) {
    // Detached the root, so create a new one.
    newNode = { type: "dir", children: new Map() };
  }

  return [newNode, oldNode];
}

function attachNode(
  root: Dir,
  parts: string[],
  newNode: Dir | Blob,
): [Dir, Dir | Blob | undefined] {
  const [dirs, oldNode] = walkDown(root, parts);

  // Walk up the tree creating updated nodes.
  let node: Dir | Blob = newNode;
  for (let i = parts.length - 1; i >= 0; i--) {
    const children = new Map(dirs[i]?.children);
    children.set(arrayGet(parts, i), node);
    node = { type: "dir", children };
  }
  if (node?.type !== "dir") {
    throw new Error("Internal error: root node must be a Dir");
  }

  return [node, oldNode];
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
      expect(dirs).toEqual([]);
      expect(node).toBe(root);
    });

    it("should throw ENOTDIR when a blob is in the path", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
      };
      expect(() => walkDown(root, ["file.txt", "sub"])).toThrow("ENOTDIR");
    });

    it("should return the node when path ends at a directory", () => {
      const dir: Dir = { type: "dir", children: new Map() };
      const root: Dir = {
        type: "dir",
        children: new Map([["dir", dir]]),
      };
      const [dirs, node] = walkDown(root, ["dir"]);
      expect(dirs).toEqual([root]);
      expect(node).toBe(dir);
    });
  });

  describe("detachNode", () => {
    it("should return root and undefined if node not found", () => {
      const root: Dir = { type: "dir", children: new Map() };
      const [newRoot, node] = detachNode(root, ["missing"]);
      expect(newRoot).toBe(root);
      expect(node).toBeUndefined();
    });

    it("should detach a blob from the root", () => {
      const blob: Blob = { type: "blob", content: ["hello"] };
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", blob]]),
      };
      const [newRoot, detached] = detachNode(root, ["file.txt"]);
      expect(detached).toBe(blob);
      expect(newRoot.children.has("file.txt")).toBe(false);
      expect(newRoot).not.toBe(root);
    });

    it("should detach a directory from the root", () => {
      const subDir: Dir = { type: "dir", children: new Map() };
      const root: Dir = {
        type: "dir",
        children: new Map([["folder", subDir]]),
      };
      const [newRoot, detached] = detachNode(root, ["folder"]);
      expect(detached).toBe(subDir);
      expect(newRoot.children.has("folder")).toBe(false);
      expect(newRoot).not.toBe(root);
    });

    it("should detach a deeply nested node", () => {
      const blob: Blob = { type: "blob", content: ["deep"] };
      const innerDir: Dir = { type: "dir", children: new Map([["file.txt", blob]]) };
      const outerDir: Dir = { type: "dir", children: new Map([["inner", innerDir]]) };
      const root: Dir = { type: "dir", children: new Map([["outer", outerDir]]) };

      const [newRoot, detached] = detachNode(root, ["outer", "inner", "file.txt"]);
      expect(detached).toBe(blob);

      const finalOuter = newRoot.children.get("outer");
      expectIsDir(finalOuter);

      const finalInner = finalOuter.children.get("inner");
      expectIsDir(finalInner);

      expect(finalInner.children.has("file.txt")).toBe(false);
      expect(newRoot).not.toBe(root);
    });

    it("should handle detaching the root itself (empty parts)", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
      };
      const [newRoot, detached] = detachNode(root, []);
      expect(detached).toBe(root);
      expect(newRoot.children.size).toBe(0);
      expect(newRoot).not.toBe(root);
    });
  });

  describe("attachNode", () => {
    it("should attach a blob to the root", () => {
      const root: Dir = { type: "dir", children: new Map() };
      const blob: Blob = { type: "blob", content: ["hello"] };
      const [newRoot, oldNode] = attachNode(root, ["file.txt"], blob);
      expect(oldNode).toBeUndefined();
      expect(newRoot.children.get("file.txt")).toBe(blob);
      expect(newRoot).not.toBe(root);
    });

    it("should replace an existing blob", () => {
      const oldBlob: Blob = { type: "blob", content: ["old"] };
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", oldBlob]]),
      };
      const newBlob: Blob = { type: "blob", content: ["new"] };
      const [newRoot, oldNode] = attachNode(root, ["file.txt"], newBlob);
      expect(oldNode).toBe(oldBlob);
      expect(newRoot.children.get("file.txt")).toBe(newBlob);
      expect(newRoot).not.toBe(root);
    });

    it("should attach a directory to the root", () => {
      const root: Dir = { type: "dir", children: new Map() };
      const subDir: Dir = { type: "dir", children: new Map() };
      const [newRoot, oldNode] = attachNode(root, ["folder"], subDir);
      expect(oldNode).toBeUndefined();
      expect(newRoot.children.get("folder")).toBe(subDir);
      expect(newRoot).not.toBe(root);
    });

    it("should attach a node deeply", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["outer", { type: "dir", children: new Map() }]]),
      };
      const blob: Blob = { type: "blob", content: ["deep"] };
      const [newRoot, oldNode] = attachNode(root, ["outer", "inner", "file.txt"], blob);

      expect(oldNode).toBeUndefined();

      const outer = newRoot.children.get("outer");
      expectIsDir(outer);
      const inner = outer.children.get("inner");
      expectIsDir(inner);
      expect(inner.children.get("file.txt")).toBe(blob);
      expect(newRoot).not.toBe(root);
    });

    it("should throw ENOTDIR if path contains a blob", () => {
      const root: Dir = {
        type: "dir",
        children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
      };
      const newNode: Blob = { type: "blob", content: ["y"] };
      expect(() => attachNode(root, ["file.txt", "sub"], newNode)).toThrow("ENOTDIR");
    });
  });

  function expectIsDir(value: Dir | Blob | undefined): asserts value is Dir {
    expect(value?.type).toBe("dir");
  }
}
