import { diffLinesMyers } from "./diff-myers.ts";
import type { Patch, PatchFile, TreeDir } from "./types.ts";

export function diffTree(oldTree: TreeDir, newTree: TreeDir): Patch {
  const files: PatchFile[] = [];

  function walk(oldDir: TreeDir | undefined, newDir: TreeDir | undefined, path: string) {
    const oldChildren = oldDir?.children;
    const newChildren = newDir?.children;

    const allKeys = new Set([
      ...(oldChildren ? Array.from(oldChildren.keys()) : []),
      ...(newChildren ? Array.from(newChildren.keys()) : []),
    ]);

    for (const key of allKeys) {
      const oldNode = oldChildren?.get(key);
      const newNode = newChildren?.get(key);
      const currentPath = path ? `${path}/${key}` : key;

      if (oldNode?.type === "dir") {
        // Update or remove the old directory.
        walk(oldNode, newNode?.type === "dir" ? newNode : undefined, currentPath);
      } else if (oldNode?.type === "blob") {
        // Update or remove the old file.
        const hunks = diffLinesMyers(
          oldNode.content,
          newNode?.type === "blob" ? newNode.content : [],
        );
        if (newNode?.type !== "blob" || hunks.length > 0) {
          files.push({
            oldPath: currentPath,
            newPath: newNode ? currentPath : "",
            hunks,
          });
        }
      }

      if (newNode?.type === "dir" && oldNode?.type !== "dir") {
        // Was not previously a directory here, so build from scratch.
        walk(undefined, newNode, currentPath);
      } else if (newNode?.type === "blob" && oldNode?.type !== "blob") {
        // Was not previously a blob here, so build from scratch.
        files.push({
          oldPath: "",
          newPath: currentPath,
          hunks: diffLinesMyers([], newNode.content),
        });
      }
    }
  }

  walk(oldTree, newTree, "");

  return { files };
}
