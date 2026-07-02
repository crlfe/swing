import { attachNode, detachNode, splitPath } from "./trees.ts";
import type { Patch, PatchHunk, TreeBlob, TreeDir, TreeNode } from "./types.ts";

export function patchLines(lines: readonly string[], hunks: readonly PatchHunk[]): string[] {
  const result = [...lines];
  let offset = 0;

  // Sort hunks by oldStart to process them in order
  const sortedHunks = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

  for (const hunk of sortedHunks) {
    const start = hunk.oldStart + offset;
    const oldLength = hunk.oldLines.length;
    const newLength = hunk.newLines.length;

    // Check if the lines to be replaced match the patch
    for (let i = 0; i < oldLength; i++) {
      if (result[start + i] !== hunk.oldLines[i]) {
        throw new Error("Patch conflicts with the current lines");
      }
    }

    // Remove old lines and insert new lines
    result.splice(start, oldLength, ...hunk.newLines);

    // Update offset for subsequent hunks
    offset += newLength - oldLength;
  }

  return result;
}

export function patchTree(root: TreeDir, patch: Patch): TreeDir {
  let currentRoot = root;

  // Detach all of the source files.
  const oldNodes = new Map<string, TreeBlob>();
  for (const file of patch.files) {
    if (!file.oldPath) continue;

    const oldParts = splitPath(file.oldPath);
    const key = oldParts.join("/");
    if (!oldNodes.has(key)) {
      let oldNode: TreeNode | undefined;
      [currentRoot, oldNode] = detachNode(currentRoot, oldParts);
      if (oldNode?.type !== "blob") {
        throw new Error(`Path is not a file: ${key}`);
      }
      oldNodes.set(key, oldNode);
    }
  }

  // Attach the patched files.
  for (const file of patch.files) {
    if (!file.newPath) continue;

    let oldLines;
    if (file.oldPath) {
      const oldParts = splitPath(file.oldPath);
      const key = oldParts.join("/");
      const oldNode = oldNodes.get(key);
      if (!oldNode) {
        throw new Error("Internal logic error");
      }
      oldLines = oldNode.content;
    } else {
      oldLines = [];
    }

    const newParts = splitPath(file.newPath);
    const content = patchLines(oldLines, file.hunks);
    const newNode: TreeBlob = { type: "blob", content };
    currentRoot = attachNode(currentRoot, newParts, newNode)[0];
  }

  return currentRoot;
}
