import { describe, expect, it } from "vitest";

import { diffLinesMyers } from "./diff-myers.ts";

describe("diffLines", () => {
  it("should return no hunks for identical content", () => {
    const oldLines = ["line 1", "line 2", "line 3"];
    const newLines = ["line 1", "line 2", "line 3"];
    expect(diffLinesMyers(oldLines, newLines)).toEqual([]);
  });

  it("should handle completely different content", () => {
    const oldLines = ["a", "b"];
    const newLines = ["c", "d"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      oldStart: 0,
      newStart: 0,
      oldLines: ["a", "b"],
      newLines: ["c", "d"],
    });
  });

  it("should handle insertions at the beginning", () => {
    const oldLines = ["line 1", "line 2"];
    const newLines = ["new line", "line 1", "line 2"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      oldStart: 0,
      newStart: 0,
      oldLines: [],
      newLines: ["new line"],
    });
  });

  it("should handle deletions at the end", () => {
    const oldLines = ["line 1", "line 2", "line 3"];
    const newLines = ["line 1", "line 2"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      oldStart: 2,
      newStart: 2,
      oldLines: ["line 3"],
      newLines: [],
    });
  });

  it("should handle mixed changes in the middle", () => {
    const oldLines = ["A", "B", "C", "D", "E"];
    const newLines = ["A", "X", "Y", "D", "E"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      oldStart: 1,
      newStart: 1,
      oldLines: ["B", "C"],
      newLines: ["X", "Y"],
    });
  });

  it("should produce multiple hunks for disjoint changes", () => {
    const oldLines = ["A", "B", "C", "D", "E"];
    const newLines = ["A", "X", "C", "Y", "E"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      oldStart: 1,
      newStart: 1,
      oldLines: ["B"],
      newLines: ["X"],
    });
    expect(result[1]).toEqual({
      oldStart: 3,
      newStart: 3,
      oldLines: ["D"],
      newLines: ["Y"],
    });
  });

  it("should handle empty input arrays", () => {
    expect(diffLinesMyers([], [])).toEqual([]);
    expect(diffLinesMyers(["a"], [])).toEqual([
      {
        oldStart: 0,
        newStart: 0,
        oldLines: ["a"],
        newLines: [],
      },
    ]);
    expect(diffLinesMyers([], ["b"])).toEqual([
      {
        oldStart: 0,
        newStart: 0,
        oldLines: [],
        newLines: ["b"],
      },
    ]);
  });

  it("should handle a complex case with multiple insertions and deletions", () => {
    const oldLines = ["The quick brown fox", "jumps over", "the lazy dog", "and runs away"];
    const newLines = ["The quick red fox", "leaps over", "the lazy dog", "and sleeps"];
    const result = diffLinesMyers(oldLines, newLines);

    expect(result).toHaveLength(2);
    expect(result[0]?.oldLines).toEqual(["The quick brown fox", "jumps over"]);
    expect(result[0]?.newLines).toEqual(["The quick red fox", "leaps over"]);
    expect(result[1]?.oldLines).toEqual(["and runs away"]);
    expect(result[1]?.newLines).toEqual(["and sleeps"]);
  });

  it("should throw an error for extremely large files", () => {
    const smallLines = Array.from({ length: 1000 }, () => String(Math.random()));
    const largeLines = Array.from({ length: 5001 }, () => String(Math.random()));
    expect(() => diffLinesMyers(smallLines, largeLines)).toThrow(/Too many lines to diff/);
    expect(() => diffLinesMyers(largeLines, smallLines)).toThrow(/Too many lines to diff/);
  });
});
