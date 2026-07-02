import { describe, expect, it } from "vitest";

import {
  attachNode,
  detachNode,
  splitPath,
  nodeFromObject,
  nodeToObject,
  walkDown,
} from "./trees.ts";
import type { TreeDir, TreeNode } from "./types.ts";

describe("splitPath", () => {
  it("should return an empty array for an empty string", () => {
    expect(splitPath("")).toEqual([]);
  });

  it("should strip single dots from path", () => {
    expect(splitPath("a/./b/./c")).toEqual(["a", "b", "c"]);
  });

  it("should resolve double-dots correctly", () => {
    expect(splitPath("a/../b/../c")).toEqual(["c"]);
  });

  it("should handle deep double-dots that go past root", () => {
    expect(splitPath("../../../foo")).toEqual(["foo"]);
  });

  it("should handle a mix of dots and double-dots", () => {
    expect(splitPath("a/./b/../c")).toEqual(["a", "c"]);
  });

  it("should handle a path with only double-dots", () => {
    expect(splitPath("../../")).toEqual([]);
  });

  it("should ignore trailing slashes", () => {
    expect(splitPath("a/b/")).toEqual(["a", "b"]);
  });

  it("should ignore leading slashes", () => {
    expect(splitPath("/a/b")).toEqual(["a", "b"]);
  });

  it("should handle multiple slashes", () => {
    expect(splitPath("a//b///c")).toEqual(["a", "b", "c"]);
  });

  it("should return empty array for root slash", () => {
    expect(splitPath("/")).toEqual([]);
  });
});

describe("walkDown", () => {
  it("should return root and undefined when no parts", () => {
    const root: TreeDir = { type: "dir", children: new Map() };
    const [dirs, node] = walkDown(root, []);
    expect(dirs).toEqual([]);
    expect(node).toBe(root);
  });

  it("should throw when a blob is in the path", () => {
    const root: TreeDir = {
      type: "dir",
      children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
    };
    expect(() => walkDown(root, ["file.txt", "sub"])).toThrow("Path component is not a directory");
  });

  it("should return the node when path ends at a directory", () => {
    const dir: TreeDir = { type: "dir", children: new Map() };
    const root: TreeDir = {
      type: "dir",
      children: new Map([["dir", dir]]),
    };
    const [dirs, node] = walkDown(root, ["dir"]);
    expect(dirs).toEqual([root]);
    expect(node).toBe(dir);
  });
});

describe("detachNode", () => {
  it("should return root and undefined if node not found", () => {
    const root = nodeFromObject({});
    const [newRoot, node] = detachNode(root, ["missing"]);
    expect(newRoot).toBe(root);
    expect(node).toBeUndefined();
  });

  it("should detach a blob from the root", () => {
    const root = nodeFromObject({ "file.txt": "hello" });
    const [newRoot, detached] = detachNode(root, ["file.txt"]);
    expect(detached).toEqual({ type: "blob", content: ["hello"] });
    expect(newRoot.children.has("file.txt")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should detach a directory from the root", () => {
    const root = nodeFromObject({ folder: { "file.txt": "hi" } });
    const [newRoot, detached] = detachNode(root, ["folder"]);
    expectIsDir(detached);
    expect(newRoot.children.has("folder")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should detach a deeply nested node", () => {
    const root = nodeFromObject({
      outer: {
        inner: {
          "file.txt": "deep",
        },
      },
    });

    const [newRoot, detached] = detachNode(root, ["outer", "inner", "file.txt"]);
    expect(detached).toEqual({ type: "blob", content: ["deep"] });

    const finalOuter = newRoot.children.get("outer");
    expectIsDir(finalOuter);

    const finalInner = finalOuter.children.get("inner");
    expectIsDir(finalInner);

    expect(finalInner.children.has("file.txt")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should handle detaching the root itself (empty parts)", () => {
    const root = nodeFromObject({ "file.txt": "x" });
    const [newRoot, detached] = detachNode(root, []);
    expect(detached).toBe(root);
    expect(newRoot.children.size).toBe(0);
    expect(newRoot).not.toBe(root);
  });
});

describe("attachNode", () => {
  it("should attach a blob to the root", () => {
    const root = nodeFromObject({});
    const blob = nodeFromObject("hello");
    const [newRoot, oldNode] = attachNode(root, ["file.txt"], blob);
    expect(oldNode).toBeUndefined();
    expect(newRoot.children.get("file.txt")).toBe(blob);
    expect(newRoot).not.toBe(root);
  });

  it("should replace an existing blob", () => {
    const root = nodeFromObject({ "file.txt": "old" });
    const newBlob = nodeFromObject("new");
    const [newRoot, oldNode] = attachNode(root, ["file.txt"], newBlob);
    expect(oldNode).toEqual({ type: "blob", content: ["old"] });
    expect(newRoot.children.get("file.txt")).toBe(newBlob);
    expect(newRoot).not.toBe(root);
  });

  it("should attach a directory to the root", () => {
    const root = nodeFromObject({});
    const subDir = nodeFromObject({ "file.txt": "hi" });
    const [newRoot, oldNode] = attachNode(root, ["folder"], subDir);
    expect(oldNode).toBeUndefined();
    expect(newRoot.children.get("folder")).toBe(subDir);
    expect(newRoot).not.toBe(root);
  });

  it("should attach a node deeply", () => {
    const root = nodeFromObject({ outer: {} });
    const blob = nodeFromObject("deep");
    const [newRoot, oldNode] = attachNode(root, ["outer", "inner", "file.txt"], blob);

    expect(oldNode).toBeUndefined();

    const outer = newRoot.children.get("outer");
    expectIsDir(outer);
    const inner = outer.children.get("inner");
    expectIsDir(inner);
    expect(inner.children.get("file.txt")).toBe(blob);
    expect(newRoot).not.toBe(root);
  });

  it("should throw if path contains a blob", () => {
    const root = nodeFromObject({ "file.txt": "x" });
    const newNode = nodeFromObject("y");
    expect(() => attachNode(root, ["file.txt", "sub"], newNode)).toThrow(
      "Path component is not a directory",
    );
  });
});

describe("treeFromObject", () => {
  it("should create a blob for a string", () => {
    const result = nodeFromObject("line 1\nline 2");
    expect(result).toEqual({ type: "blob", content: ["line 1", "line 2"] });
  });

  it("should create an empty tree for an empty object", () => {
    const root = nodeFromObject({});
    expect(root.children.size).toBe(0);
  });

  it("should create a tree from an object with string values", () => {
    const root = nodeFromObject({
      "file1.txt": "line 1\nline 2",
      "file2.txt": "single line",
    });

    expectIsDir(root);
    expect(root.children.size).toBe(2);

    const file1 = root.children.get("file1.txt");
    expect(file1).toEqual({ type: "blob", content: ["line 1", "line 2"] });

    const file2 = root.children.get("file2.txt");
    expect(file2).toEqual({ type: "blob", content: ["single line"] });
  });

  it("should create nested directories from objects", () => {
    const root = nodeFromObject({
      src: {
        "index.ts": "console.log('hello')",
        utils: {
          "math.ts": "export const add = (a, b) => a + b",
        },
      },
      "package.json": "{}",
    });

    expectIsDir(root);
    expect(root.children.size).toBe(2);

    const src = root.children.get("src");
    expectIsDir(src);
    expect(src.children.size).toBe(2);

    const index = src.children.get("index.ts");
    expect(index).toEqual({ type: "blob", content: ["console.log('hello')"] });

    const utils = src.children.get("utils");
    expectIsDir(utils);
    expect(utils.children.size).toBe(1);

    const math = utils.children.get("math.ts");
    expect(math).toEqual({ type: "blob", content: ["export const add = (a, b) => a + b"] });

    const pkg = root.children.get("package.json");
    expect(pkg).toEqual({ type: "blob", content: ["{}"] });
  });
});

/** Helper to assert that a node is a directory and narrow its type for TypeScript. */
function expectIsDir(value: TreeNode | undefined): asserts value is TreeDir {
  expect(value?.type).toBe("dir");
}

describe("nodeToObject", () => {
  it("should convert a blob to a string with a trailing newline", () => {
    const blob: TreeNode = { type: "blob", content: ["line 1", "line 2"] };
    expect(nodeToObject(blob)).toBe("line 1\nline 2\n");
  });

  it("should convert a single-line blob to a string with a trailing newline", () => {
    const blob: TreeNode = { type: "blob", content: ["hello"] };
    expect(nodeToObject(blob)).toBe("hello\n");
  });

  it("should convert an empty blob to a single newline", () => {
    const blob: TreeNode = { type: "blob", content: [] };
    expect(nodeToObject(blob)).toBe("\n");
  });

  it("should convert a directory to an object", () => {
    const root: TreeDir = {
      type: "dir",
      children: new Map([
        ["file1.txt", { type: "blob", content: ["content1"] }],
        ["file2.txt", { type: "blob", content: ["content2"] }],
      ]),
    };
    expect(nodeToObject(root)).toEqual({
      "file1.txt": "content1\n",
      "file2.txt": "content2\n",
    });
  });

  it("should convert a nested directory structure to a recursive object", () => {
    const root: TreeDir = {
      type: "dir",
      children: new Map([
        [
          "src",
          {
            type: "dir",
            children: new Map([["index.ts", { type: "blob", content: ["import 'fs'"] }]]),
          },
        ],
        ["package.json", { type: "blob", content: ["{}"] }],
      ]),
    };
    expect(nodeToObject(root)).toEqual({
      src: {
        "index.ts": "import 'fs'\n",
      },
      "package.json": "{}\n",
    });
  });

  it("should handle empty directories", () => {
    const root: TreeDir = { type: "dir", children: new Map() };
    expect(nodeToObject(root)).toEqual({});
  });
});

describe("roundtrip", () => {
  it("should maintain consistency between nodeFromObject and nodeToObject", () => {
    const original = {
      "README.md": "Hello\nWorld",
      src: {
        "main.ts": "console.log('hi')",
        lib: {
          "util.ts": "export const a = 1",
        },
      },
      ".gitignore": "node_modules\n",
    };
    const node = nodeFromObject(original);
    const result = nodeToObject(node);

    // Note: nodeToObject adds a trailing newline to blobs
    const expected = {
      "README.md": "Hello\nWorld\n",
      src: {
        "main.ts": "console.log('hi')\n",
        lib: {
          "util.ts": "export const a = 1\n",
        },
      },
      ".gitignore": "node_modules\n\n",
    };
    expect(result).toEqual(expected);
  });
});
