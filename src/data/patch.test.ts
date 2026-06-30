import { describe, expect, it } from "vitest";

import { patchLines } from "./patch.ts";
import type { PatchHunk } from "./types.ts";

describe("patchLines", () => {
  it("should return the same lines if no hunks are provided", () => {
    const lines = ["line 1", "line 2", "line 3"];
    const hunks: PatchHunk[] = [];
    expect(patchLines(lines, hunks)).toEqual(lines);
  });

  it("should replace a single line", () => {
    const lines = ["line 1", "line 2", "line 3"];
    const hunks: PatchHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        oldLines: ["line 2"],
        newLines: ["line 2 modified"],
      },
    ];
    const expected = ["line 1", "line 2 modified", "line 3"];
    expect(patchLines(lines, hunks)).toEqual(expected);
  });

  it("should replace multiple lines with a different number of lines", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4"];
    const hunks: PatchHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        oldLines: ["line 2", "line 3"],
        newLines: ["line 2 modified", "line 2.1", "line 3 modified"],
      },
    ];
    const expected = ["line 1", "line 2 modified", "line 2.1", "line 3 modified", "line 4"];
    expect(patchLines(lines, hunks)).toEqual(expected);
  });

  it("should handle multiple hunks and track offsets correctly", () => {
    const lines = ["line 1", "line 2", "line 3", "line 4", "line 5"];
    const hunks: PatchHunk[] = [
      {
        oldStart: 0,
        newStart: 0,
        oldLines: ["line 1"],
        newLines: ["line 1 modified", "line 1.1"],
      },
      {
        oldStart: 3,
        newStart: 4,
        oldLines: ["line 4"],
        newLines: ["line 4 modified"],
      },
    ];
    const expected = [
      "line 1 modified",
      "line 1.1",
      "line 2",
      "line 3",
      "line 4 modified",
      "line 5",
    ];
    expect(patchLines(lines, hunks)).toEqual(expected);
  });

  it("should not mutate the input lines array", () => {
    const lines = ["line 1", "line 2"];
    const linesCopy = [...lines];
    const hunks: PatchHunk[] = [
      {
        oldStart: 0,
        newStart: 0,
        oldLines: ["line 1"],
        newLines: ["modified"],
      },
    ];
    patchLines(lines, hunks);
    expect(lines).toEqual(linesCopy);
  });

  it("should handle deletions (empty newLines)", () => {
    const lines = ["line 1", "line 2", "line 3"];
    const hunks: PatchHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        oldLines: ["line 2"],
        newLines: [],
      },
    ];
    const expected = ["line 1", "line 3"];
    expect(patchLines(lines, hunks)).toEqual(expected);
  });

  it("should handle additions (empty oldLines)", () => {
    const lines = ["line 1", "line 2"];
    const hunks: PatchHunk[] = [
      {
        oldStart: 1,
        newStart: 1,
        oldLines: [],
        newLines: ["line 1.5"],
      },
    ];
    const expected = ["line 1", "line 1.5", "line 2"];
    expect(patchLines(lines, hunks)).toEqual(expected);
  });
});
