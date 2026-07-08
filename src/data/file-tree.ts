import {
  attachNode,
  detachNode,
  nodeFromObject,
  nodeToObject,
  type RecursiveRecord,
  splitPath,
  walkDown,
} from "./trees.ts";
import type { TreeDir, TreeNode } from "./types.ts";

export type FileTreeListener = (path: string) => void;

interface FileTreeWatch {
  callback: FileTreeListener;
  recursive: boolean;
}

export class FileTree {
  #root: TreeDir;
  #watchers: Map<string, Set<FileTreeWatch>> = new Map();

  fromJSON(json: RecursiveRecord<string, string>): void {
    this.#root = nodeFromObject(json);
    this.#notifyAllWatchers();
  }

  toJSON(): RecursiveRecord<string, string> {
    return nodeToObject(this.#root);
  }

  get size(): number {
    let count = 0;
    this.walk("", (path, node) => {
      if (node.type === "blob") count++;
    });
    return count;
  }

  clear(): void {
    this.#root = { type: "dir", children: new Map() };
    this.#notifyAllWatchers();
  }

  constructor(root?: TreeDir) {
    this.#root = root ?? { type: "dir", children: new Map() };
  }

  list(): string[] {
    const result: string[] = [];
    this.walk("", (path, node) => {
      if (path) result.push(path + (node.type === "dir" ? "/" : ""));
      return true;
    });
    return result.sort();
  }

  listWithDirectoriesFirst(): string[] {
    const result: string[] = [];
    const recurse = (path: string, node: TreeNode) => {
      if (node.type === "dir") {
        const children = Array.from(node.children.entries()).sort(([a], [b]) => a.localeCompare(b));

        // Directories first, then blobs
        const dirs = children.filter(([_, v]) => v.type === "dir");
        const blobs = children.filter(([_, v]) => v.type === "blob");

        for (const [name, child] of [...dirs, ...blobs]) {
          const childPath = path ? `${path}/${name}` : name;
          result.push(childPath + (child.type === "dir" ? "/" : ""));
          if (child.type === "dir") recurse(childPath, child);
        }
      }
    };
    recurse("", this.#root);
    return result;
  }

  getRoot() {
    return this.#root;
  }

  getNode(path: string): TreeNode {
    const node = walkDown(this.#root, splitPath(path))[1];
    if (!node) {
      throw new Error("Path not found");
    }
    return node;
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

  walk(path: string, callback: (path: string, node: TreeNode) => boolean | undefined | void): void {
    const parts = splitPath(path);
    const node = walkDown(this.#root, parts)[1];
    if (!node) {
      throw new Error("Path not found");
    }
    recurse(parts, node);

    function recurse(parts: string[], node: TreeNode) {
      if (parts.length && callback(parts.join("/"), node) === false) {
        return;
      }
      if (node.type === "dir") {
        for (const [name, child] of node.children) {
          recurse([...parts, name], child);
        }
      }
    }
  }

  async walkAsync(
    path: string,
    callback: (path: string, node: TreeNode) => Promise<boolean | undefined | void>,
  ): Promise<void> {
    const parts = splitPath(path);
    const node = walkDown(this.#root, parts)[1];
    if (!node) {
      throw new Error("Path not found");
    }
    await recurse(parts, node);

    async function recurse(parts: string[], node: TreeNode) {
      if (parts.length && (await callback(parts.join("/"), node)) === false) {
        return;
      }
      if (node.type === "dir") {
        for (const [name, child] of node.children) {
          await recurse([...parts, name], child);
        }
      }
    }
  }

  has(path: string): boolean {
    return walkDown(this.#root, splitPath(path))[1] != undefined;
  }

  read(path: string): ReadonlyArray<string> {
    const node = walkDown(this.#root, splitPath(path))[1];
    if (!node) {
      throw new Error("Path not found");
    }
    if (node.type === "dir") {
      throw new Error("Can not read a directory");
    }
    return node.content;
  }

  write(path: string, content: ReadonlyArray<string>): boolean {
    const parts = splitPath(path);
    const [newRoot, oldNode] = attachNode(this.#root, parts, { type: "blob", content });

    if (oldNode?.type === "dir") {
      // Can not replace a dir with a blob.
      throw new Error("Can not write a directory");
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

  delete(path: string, options?: { recursive?: boolean }): void {
    const parts = splitPath(path);
    const [newRoot, oldNode] = detachNode(this.#root, parts);

    if (!oldNode) {
      throw new Error("Path not found");
    }
    if (oldNode.type === "dir" && oldNode.children.size && !options?.recursive) {
      throw new Error("Directory not empty");
    }

    this.#root = newRoot;
    this.#notifyWatchers(path);
  }

  move(oldPath: string, newPath: string): void {
    if (oldPath === newPath) {
      // Nothing is changing.
      return;
    }

    const oldParts = splitPath(oldPath);
    const [movingRoot, movingNode] = detachNode(this.#root, oldParts);
    if (!movingNode) {
      throw new Error("Path not found");
    }

    const newParts = splitPath(newPath);
    const [newRoot, replacedNode] = attachNode(movingRoot, newParts, movingNode);

    if (replacedNode && (replacedNode.type !== "blob" || movingNode.type !== "blob")) {
      // Can move a blob on top of another blob, but other combinations fail.
      throw new Error("Destination path already exists");
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

  #notifyAllWatchers() {
    for (const callbacks of this.#watchers.values()) {
      for (const { callback } of callbacks) {
        callback("");
      }
    }
  }
}
