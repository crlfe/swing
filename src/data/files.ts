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
    return walkDown(this.#root, splitPath(path))[1];
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

    const [dirs, oldNode] = walkDown(this.#root, parts);

    if (oldNode?.type === "dir") {
      // Can not replace a dir with a blob.
      throw new Error("EISDIR");
    }

    if (oldNode?.type === "blob" && oldNode.content === content) {
      // Nothing is changing.
      return false;
    }

    // Walk up the tree creating updated nodes.
    let node: Dir | Blob = { type: "blob", content };
    for (let i = parts.length - 1; i >= 0; i--) {
      const children = new Map(dirs[i]?.children);
      children.set(parts[i], node);
      node = { type: "dir", children };
    }
    if (node?.type !== "dir") {
      throw new Error("ASSERT");
    }

    this.#root = node;
    return true;
  }

  delete(path: string): boolean {
    const parts = splitPath(path);
    if (parts.length < 1) {
      throw new Error();
    }

    const [dirs, oldNode] = walkDown(this.#root, parts);

    if (oldNode?.type === "dir" && oldNode.children.size) {
      // Can not delete a non-empty directory.
      throw Error("ENOTEMPTY");
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
      throw new Error("ASSERT");
    }

    this.#root = node;
    return true;
  }

  move(oldPath: string, newPath: string): void {
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

    if (node?.type !== "dir") {
      throw new Error("ASSERT");
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
      throw new Error("ASSERT");
    }

    this.#root = node2;
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
      throw Error("ENOTDIR");
    }
    if (node?.type === "dir") {
      dirs.push(node);
      node = node.children.get(name);
    }
  }

  return [dirs, node];
}
