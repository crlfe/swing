import type { PatchHunk } from "./types.ts";

export function patchLines(lines: string[], hunks: PatchHunk[]): string[] {
  const result = [...lines];
  let offset = 0;

  // Sort hunks by oldStart to process them in order
  const sortedHunks = [...hunks].sort((a, b) => a.oldStart - b.oldStart);

  for (const hunk of sortedHunks) {
    const start = hunk.oldStart + offset;
    const oldLength = hunk.oldLines.length;
    const newLength = hunk.newLines.length;

    // Remove old lines and insert new lines
    result.splice(start, oldLength, ...hunk.newLines);

    // Update offset for subsequent hunks
    offset += newLength - oldLength;
  }

  return result;
}
