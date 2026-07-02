import { describe, expect, it } from "vitest";

import { patchLines, patchTree } from "./patch.ts";
import { nodeFromObject, nodeToObject } from "./trees.ts";
import type { Patch, PatchHunk, TreeDir } from "./types.ts";

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

describe("patchTree", () => {
  it("should apply a patch to a single file", () => {
    const root = nodeFromObject({ "file.txt": "line 1\nline 2\n" }) as TreeDir;
    const patch: Patch = {
      files: [
        {
          oldPath: "file.txt",
          newPath: "file.txt",
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              oldLines: ["line 2"],
              newLines: ["line 2 modified"],
            },
          ],
        },
      ],
    };

    const result = patchTree(root, patch);
    expect(nodeToObject(result)).toEqual({ "file.txt": "line 1\nline 2 modified\n" });
  });

  it("should move a file and patch its content", () => {
    const root = nodeFromObject({ old: { "file.txt": "line 1\nline 2\n" } }) as TreeDir;
    const patch: Patch = {
      files: [
        {
          oldPath: "old/file.txt",
          newPath: "new/file.txt",
          hunks: [
            {
              oldStart: 0,
              newStart: 0,
              oldLines: ["line 1"],
              newLines: ["line 1 modified"],
            },
          ],
        },
      ],
    };

    const result = patchTree(root, patch);
    expect(nodeToObject(result)).toEqual({
      new: { "file.txt": "line 1 modified\nline 2\n" },
      old: {},
    });
  });

  it("should handle multiple files in a patch", () => {
    const root = nodeFromObject({
      "a.txt": "a1",
      "b.txt": "b1",
    }) as TreeDir;
    const patch: Patch = {
      files: [
        {
          oldPath: "a.txt",
          newPath: "a.txt",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: ["a1"], newLines: ["a2"] }],
        },
        {
          oldPath: "b.txt",
          newPath: "b.txt",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: ["b1"], newLines: ["b2"] }],
        },
      ],
    };

    const result = patchTree(root, patch);
    expect(nodeToObject(result)).toEqual({ "a.txt": "a2", "b.txt": "b2" });
  });

  it("should throw if a file does not exist in the tree", () => {
    const root = nodeFromObject({ "exists.txt": "content" }) as TreeDir;
    const patch: Patch = {
      files: [
        {
          oldPath: "missing.txt",
          newPath: "missing.txt",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: [], newLines: ["new"] }],
        },
      ],
    };

    expect(() => patchTree(root, patch)).toThrow("Path is not a file: missing.txt");
  });

  it("should apply a complex patch with mixed additions, deletions, and modifications", () => {
    const root = nodeFromObject({
      "README.md": "# Project\nOld description\n",
      src: {
        "index.ts": "console.log('init');\n",
        "utils.ts": "export const a = 1;\n",
      },
      "temp.log": "log line 1",
    }) as TreeDir;

    const patch: Patch = {
      files: [
        {
          oldPath: "README.md",
          newPath: "README.md",
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              oldLines: ["Old description"],
              newLines: ["New description", "More info"],
            },
          ],
        },
        {
          oldPath: "src/index.ts",
          newPath: "src/index.ts",
          hunks: [{ oldStart: 1, newStart: 1, oldLines: [], newLines: ["console.log('start');"] }],
        },
        {
          oldPath: "src/utils.ts",
          newPath: "",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: ["export const a = 1;"], newLines: [] }],
        },
        {
          oldPath: "",
          newPath: "src/types.ts",
          hunks: [
            { oldStart: 0, newStart: 0, oldLines: [], newLines: ["export type T = string;", ""] },
          ],
        },
        {
          oldPath: "temp.log",
          newPath: "",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: ["log line 1"], newLines: [] }],
        },
        {
          oldPath: "",
          newPath: "docs/api.md",
          hunks: [{ oldStart: 0, newStart: 0, oldLines: [], newLines: ["API Docs", ""] }],
        },
      ],
    };

    const patchedRoot = patchTree(root, patch);
    const result = nodeToObject(patchedRoot);

    expect(result).toEqual({
      "README.md": "# Project\nNew description\nMore info\n",
      src: {
        "index.ts": "console.log('init');\nconsole.log('start');\n",
        "types.ts": "export type T = string;\n",
      },
      docs: {
        "api.md": "API Docs\n",
      },
    });
  });
});
