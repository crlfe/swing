import { attachNode, detachNode, splitPath, walkDown } from "./trees.ts";
import type { TreeDir, TreeNode } from "./types.ts";

export type FileTreeListener = (path: string) => void;

interface FileTreeWatch {
  callback: FileTreeListener;
  recursive: boolean;
}

export class FileTree {
  #root: TreeDir;
  #watchers: Map<string, Set<FileTreeWatch>> = new Map();

  constructor(root?: TreeDir) {
    this.#root = root ?? { type: "dir", children: new Map() };
  }

  getRoot() {
    return this.#root;
  }

  getNode(path: string): TreeNode | undefined {
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

  read(path: string): ReadonlyArray<string> | undefined {
    const node = this.getNode(path);
    if (node?.type === "dir") {
      throw new Error("Can not read a directory");
    }
    return node?.content;
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

  delete(path: string, options?: { recursive?: boolean }): boolean {
    const parts = splitPath(path);
    const [newRoot, oldNode] = detachNode(this.#root, parts);

    if (oldNode?.type === "dir" && oldNode.children.size && !options?.recursive) {
      throw new Error("Directory not empty");
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
}
