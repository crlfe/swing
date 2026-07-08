import { diffLinesMyers } from "./diff-myers.ts";
import type { Patch, PatchFile, TreeDir } from "./types.ts";

export function diffTree(oldTree: TreeDir, newTree: TreeDir): Patch {
  const files: PatchFile[] = [];

  function walk(oldDir: TreeDir | undefined, newDir: TreeDir | undefined, path: string) {
    if (oldDir === newDir) return;

    const oldChildren = oldDir?.children;
    const newChildren = newDir?.children;

    const allKeys = Array.from(
      new Set([
        ...(oldChildren ? Array.from(oldChildren.keys()) : []),
        ...(newChildren ? Array.from(newChildren.keys()) : []),
      ]),
    );
    allKeys.sort();

    for (const key of allKeys) {
      const oldNode = oldChildren?.get(key);
      const newNode = newChildren?.get(key);
      if (oldNode === newNode) continue;

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

export function formatPatch(patch: Patch): string {
  return patch.files
    .map((file) => {
      let output = "";
      if (file.oldPath && file.newPath) {
        output += `--- ${file.oldPath}\n+++ ${file.newPath}\n`;
      } else if (file.oldPath) {
        output += `--- ${file.oldPath}\n+++ /dev/null\n`;
      } else if (file.newPath) {
        output += `--- /dev/null\n+++ ${file.newPath}\n`;
      }

      for (const hunk of file.hunks) {
        const oldLen = hunk.oldLines.length;
        const newLen = hunk.newLines.length;
        output += `@@ -${hunk.oldStart},${oldLen} +${hunk.newStart},${newLen} @@\n`;

        for (const line of hunk.oldLines) {
          output += `-${line}\n`;
        }
        for (const line of hunk.newLines) {
          output += `+${line}\n`;
        }
      }
      return output;
    })
    .join("\n");
}
