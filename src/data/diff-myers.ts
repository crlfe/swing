import { arrayGet } from "../util.ts";
import type { PatchHunk } from "./types.ts";

/**
 * Computes the difference between two arrays of lines using Myers' Diff Algorithm. This
 * implementation finds the Shortest Edit Script (SES).
 */
export function diffLinesMyers(oldLines: string[], newLines: string[]): PatchHunk[] {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const n = oldEnd - start;
  const m = newEnd - start;

  const MAX_DIFF_SIZE = 5000;
  if (n > MAX_DIFF_SIZE || m > MAX_DIFF_SIZE) {
    throw new Error(`Too many lines to diff using this algorithm (max ${MAX_DIFF_SIZE} lines).`);
  }

  // The "V" array stores the furthest reaching x-coordinate on each diagonal k
  // k = x - y
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];

  let x = 0;
  let y = 0;

  // Find the shortest edit script
  for (let d = 0; d <= max; d++) {
    trace.push(new Int32Array(v));
    for (let k = -d; k <= d; k += 2) {
      if (k === -d || (k !== d && arrayGet(v, max + k - 1) < arrayGet(v, max + k + 1))) {
        x = arrayGet(v, max + k + 1);
      } else {
        x = arrayGet(v, max + k - 1) + 1;
      }
      y = x - k;

      while (x < n && y < m && oldLines[start + x] === newLines[start + y]) {
        x++;
        y++;
      }
      v[max + k] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, oldLines, newLines, start, oldEnd, newEnd);
      }
    }
  }

  return backtrack(trace, oldLines, newLines, start, oldEnd, newEnd);
}

function backtrack(
  trace: Int32Array[],
  oldLines: string[],
  newLines: string[],
  start: number,
  oldEnd: number,
  newEnd: number,
): PatchHunk[] {
  const n = oldEnd - start;
  const m = newEnd - start;
  let x = n;
  let y = m;
  const edits: { type: "old" | "new" | "same"; line: string }[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = arrayGet(trace, d);
    const max = n + m;
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && arrayGet(v, max + k - 1) < arrayGet(v, max + k + 1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = arrayGet(v, max + prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      edits.push({ type: "same", line: arrayGet(oldLines, start + x - 1) });
      x--;
      y--;
    }

    if (d > 0) {
      if (x > prevX) {
        edits.push({ type: "old", line: arrayGet(oldLines, start + x - 1) });
        x--;
      } else if (y > prevY) {
        edits.push({ type: "new", line: arrayGet(newLines, start + y - 1) });
        y--;
      }
    }
  }

  edits.reverse();

  // Group edits into hunks
  const hunks: PatchHunk[] = [];
  let i = 0;
  let currentOldIdx = start;
  let currentNewIdx = start;

  while (i < edits.length) {
    let edit = arrayGet(edits, i);
    if (edit.type === "same") {
      currentOldIdx++;
      currentNewIdx++;
      i++;
      continue;
    }

    const hunkOldStart = currentOldIdx;
    const hunkNewStart = currentNewIdx;
    const hunkOldLines: string[] = [];
    const hunkNewLines: string[] = [];

    while (i < edits.length) {
      let edit = arrayGet(edits, i);
      if (edit.type === "same") {
        break;
      }

      if (edit.type === "old") {
        hunkOldLines.push(edit.line);
        currentOldIdx++;
      } else if (edit.type === "new") {
        hunkNewLines.push(edit.line);
        currentNewIdx++;
      }

      i++;
    }

    hunks.push({
      oldStart: hunkOldStart,
      newStart: hunkNewStart,
      oldLines: hunkOldLines,
      newLines: hunkNewLines,
    });
  }

  return hunks;
}
