import { arrayGet } from "../util.ts";
import type { TreeDir, TreeNode } from "./types.ts";

export function splitPath(path: string): string[] {
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

export function walkDown(root: TreeDir, parts: string[]): [TreeDir[], TreeNode | undefined] {
  const dirs: TreeDir[] = [];

  let node: TreeNode | undefined = root;
  for (const name of parts) {
    if (node?.type === "blob") {
      throw new Error("Path component is not a directory");
    }
    if (node?.type === "dir") {
      dirs.push(node);
      node = node.children.get(name);
    }
  }

  return [dirs, node];
}

export function detachNode(root: TreeDir, parts: string[]): [TreeDir, TreeNode | undefined] {
  const [dirs, oldNode] = walkDown(root, parts);
  if (!oldNode) {
    // Nothing changed.
    return [root, undefined];
  }

  let newNode: TreeDir | undefined;
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

export function attachNode(
  root: TreeDir,
  parts: string[],
  newNode: TreeNode,
): [TreeDir, TreeNode | undefined] {
  const [dirs, oldNode] = walkDown(root, parts);

  // Walk up the tree creating updated nodes.
  let node: TreeNode = newNode;
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
