import { describe, expect, it } from "vitest";

import { diffTree } from "./diff.ts";
import { nodeFromObject } from "./trees.ts";
import type { TreeDir } from "./types.ts";

describe("diffTree", () => {
  it("should return an empty patch for identical trees", () => {
    const tree = nodeFromObject({
      "file1.txt": "line1\nline2",
    }) as TreeDir;

    const patch = diffTree(tree, tree);
    expect(patch.files.length).toBe(0);
  });

  it("should detect changes in a file", () => {
    const oldTree = nodeFromObject({
      "file1.txt": "line1\nline2",
    }) as TreeDir;
    const newTree = nodeFromObject({
      "file1.txt": "line1\nchanged\nline3",
    }) as TreeDir;

    const patch = diffTree(oldTree, newTree);
    expect(patch).toMatchObject({
      files: [
        {
          oldPath: "file1.txt",
          newPath: "file1.txt",
          hunks: [
            {
              oldLines: ["line2"],
              newLines: ["changed", "line3"],
            },
          ],
        },
      ],
    });
  });

  it("should detect added files", () => {
    const oldTree = nodeFromObject({}) as TreeDir;
    const newTree = nodeFromObject({
      "new.txt": "hello",
    }) as TreeDir;

    const patch = diffTree(oldTree, newTree);
    expect(patch).toMatchObject({
      files: [
        {
          oldPath: "",
          newPath: "new.txt",
          hunks: [
            {
              oldLines: [],
              newLines: ["hello"],
            },
          ],
        },
      ],
    });
  });

  it("should detect deleted files", () => {
    const oldTree = nodeFromObject({
      "old.txt": "bye",
    }) as TreeDir;
    const newTree = nodeFromObject({}) as TreeDir;

    const patch = diffTree(oldTree, newTree);
    expect(patch).toMatchObject({
      files: [
        {
          oldPath: "old.txt",
          newPath: "",
          hunks: [
            {
              oldLines: ["bye"],
              newLines: [],
            },
          ],
        },
      ],
    });
  });

  it("should handle nested directories", () => {
    const oldTree = nodeFromObject({
      src: {
        "main.ts": "const a = 1;",
      },
    }) as TreeDir;
    const newTree = nodeFromObject({
      src: {
        "main.ts": "const a = 2;",
      },
    }) as TreeDir;

    const patch = diffTree(oldTree, newTree);
    expect(patch).toMatchObject({
      files: [
        {
          oldPath: "src/main.ts",
          newPath: "src/main.ts",
          hunks: [
            {
              oldLines: ["const a = 1;"],
              newLines: ["const a = 2;"],
            },
          ],
        },
      ],
    });
  });

  it("should handle a complex scenario with mixed additions, deletions, and modifications", () => {
    const oldTree = nodeFromObject({
      "README.md": "# Project\nOld description",
      src: {
        "index.ts": "console.log('init');",
        "utils.ts": "export const a = 1;",
      },
      "temp.log": "log line 1",
    }) as TreeDir;

    const newTree = nodeFromObject({
      "README.md": "# Project\nNew description\nMore info",
      src: {
        "index.ts": "console.log('init');\nconsole.log('start');",
        "types.ts": "export type T = string;",
      },
      docs: {
        "api.md": "API Docs",
      },
    }) as TreeDir;

    const patch = diffTree(oldTree, newTree);
    expect(patch).toMatchObject({
      files: [
        {
          oldPath: "README.md",
          newPath: "README.md",
          hunks: [
            {
              oldLines: ["Old description"],
              newLines: ["New description", "More info"],
            },
          ],
        },
        {
          oldPath: "src/index.ts",
          newPath: "src/index.ts",
          hunks: [
            {
              oldLines: [],
              newLines: ["console.log('start');"],
            },
          ],
        },
        {
          oldPath: "src/utils.ts",
          newPath: "",
          hunks: [
            {
              oldLines: ["export const a = 1;"],
              newLines: [],
            },
          ],
        },
        {
          oldPath: "",
          newPath: "src/types.ts",
          hunks: [
            {
              oldLines: [],
              newLines: ["export type T = string;"],
            },
          ],
        },
        {
          oldPath: "temp.log",
          newPath: "",
          hunks: [
            {
              oldLines: ["log line 1"],
              newLines: [],
            },
          ],
        },
        {
          oldPath: "",
          newPath: "docs/api.md",
          hunks: [
            {
              oldLines: [],
              newLines: ["API Docs"],
            },
          ],
        },
      ],
    });
  });
});
