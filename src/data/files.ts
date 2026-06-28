export interface Dir {
  readonly type: "dir";
  readonly children: Map<string, Dir | Blob>;
}

export interface Blob {
  readonly type: "blob";
  readonly content: string;
}

export class Files {
  #root: Dir;

  constructor(root?: Dir) {
    this.#root = root ?? { type: "dir", children: new Map() };
  }

  getRoot() {
    return this.#root;
  }

  getNode(path: string): Dir | Blob | undefined {
    let node: Dir | Blob | undefined = this.#root;
    for (const name of splitPath(path)) {
      if (node?.type !== "dir") {
        return undefined;
      }
      node = node.children.get(name);
    }
    return node;
  }

  read(path: string): string | undefined {
    const node = this.getNode(path);
    if (node?.type === "dir") {
      throw new Error("EISDIR");
    }
    return node?.content;
  }

  write(path: string, content: string): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error();
    }

    const trees: Dir[] = [];

    // Walk down the tree collecting nodes.
    {
      let node: Dir | Blob | undefined = this.#root;
      for (const name of parts) {
        if (node?.type === "blob") {
          // Can not replace a blob with a tree.
          throw Error("ENOTDIR");
        }
        if (node?.type === "dir") {
          trees.push(node);
          node = node.children.get(name);
        }
      }

      if (node?.type === "dir") {
        // Can not replace a tree with a blob.
        throw new Error("EISDIR");
      }

      if (node?.type === "blob" && node.content === content) {
        // Nothing is changing.
        return false;
      }
    }

    // Walk up the tree creating updated nodes.
    {
      let node: Dir | Blob = { type: "blob", content };
      for (let i = parts.length - 1; i >= 0; i--) {
        const children = new Map(trees[i]?.children);
        children.set(parts[i], node);
        node = { type: "dir", children };
      }
      if (node?.type !== "dir") {
        throw new Error("ASSERT");
      }

      this.#root = node;
    }

    return true;
  }

  delete(path: string): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error();
    }

    const trees: Dir[] = [];

    // Walk down the tree collecting nodes.
    {
      let node: Dir | Blob | undefined = this.#root;
      for (const name of parts) {
        if (node?.type === "blob") {
          // Can not replace a blob with a tree.
          throw Error("ENOTDIR");
        }
        if (node?.type === "dir") {
          trees.push(node);
          node = node.children.get(name);
        }
      }

      if (node?.type === "dir" && node.children.size) {
        // Can not delete a non-empty directory.
        throw new Error("ENOTEMPTY");
      }

      if (!node) {
        // Nothing is changing.
        return false;
      }
    }

    // Walk up the tree creating updated nodes.
    {
      let node: Dir | undefined;
      for (let i = parts.length - 1; i >= 0; i--) {
        const children = new Map(trees[i]?.children);
        if (node) {
          children.set(parts[i], node);
        } else {
          children.delete(parts[i]);
        }
        node = { type: "dir", children };
      }

      if (node?.type !== "dir") {
        throw new Error("ASSERT");
      }

      this.#root = node;
    }

    return true;
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
