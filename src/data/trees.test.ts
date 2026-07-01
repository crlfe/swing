import { describe, expect, it } from "vitest";

import { attachNode, detachNode, splitPath, walkDown } from "./trees.ts";
import type { TreeBlob, TreeDir, TreeNode } from "./types.ts";

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
    const root: TreeDir = { type: "dir", children: new Map() };
    const [newRoot, node] = detachNode(root, ["missing"]);
    expect(newRoot).toBe(root);
    expect(node).toBeUndefined();
  });

  it("should detach a blob from the root", () => {
    const blob: TreeBlob = { type: "blob", content: ["hello"] };
    const root: TreeDir = {
      type: "dir",
      children: new Map([["file.txt", blob]]),
    };
    const [newRoot, detached] = detachNode(root, ["file.txt"]);
    expect(detached).toBe(blob);
    expect(newRoot.children.has("file.txt")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should detach a directory from the root", () => {
    const subDir: TreeDir = { type: "dir", children: new Map() };
    const root: TreeDir = {
      type: "dir",
      children: new Map([["folder", subDir]]),
    };
    const [newRoot, detached] = detachNode(root, ["folder"]);
    expect(detached).toBe(subDir);
    expect(newRoot.children.has("folder")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should detach a deeply nested node", () => {
    const blob: TreeBlob = { type: "blob", content: ["deep"] };
    const innerDir: TreeDir = { type: "dir", children: new Map([["file.txt", blob]]) };
    const outerDir: TreeDir = { type: "dir", children: new Map([["inner", innerDir]]) };
    const root: TreeDir = { type: "dir", children: new Map([["outer", outerDir]]) };

    const [newRoot, detached] = detachNode(root, ["outer", "inner", "file.txt"]);
    expect(detached).toBe(blob);

    const finalOuter = newRoot.children.get("outer");
    expectIsDir(finalOuter);

    const finalInner = finalOuter.children.get("inner");
    expectIsDir(finalInner);

    expect(finalInner.children.has("file.txt")).toBe(false);
    expect(newRoot).not.toBe(root);
  });

  it("should handle detaching the root itself (empty parts)", () => {
    const root: TreeDir = {
      type: "dir",
      children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
    };
    const [newRoot, detached] = detachNode(root, []);
    expect(detached).toBe(root);
    expect(newRoot.children.size).toBe(0);
    expect(newRoot).not.toBe(root);
  });
});

describe("attachNode", () => {
  it("should attach a blob to the root", () => {
    const root: TreeDir = { type: "dir", children: new Map() };
    const blob: TreeBlob = { type: "blob", content: ["hello"] };
    const [newRoot, oldNode] = attachNode(root, ["file.txt"], blob);
    expect(oldNode).toBeUndefined();
    expect(newRoot.children.get("file.txt")).toBe(blob);
    expect(newRoot).not.toBe(root);
  });

  it("should replace an existing blob", () => {
    const oldBlob: TreeBlob = { type: "blob", content: ["old"] };
    const root: TreeDir = {
      type: "dir",
      children: new Map([["file.txt", oldBlob]]),
    };
    const newBlob: TreeBlob = { type: "blob", content: ["new"] };
    const [newRoot, oldNode] = attachNode(root, ["file.txt"], newBlob);
    expect(oldNode).toBe(oldBlob);
    expect(newRoot.children.get("file.txt")).toBe(newBlob);
    expect(newRoot).not.toBe(root);
  });

  it("should attach a directory to the root", () => {
    const root: TreeDir = { type: "dir", children: new Map() };
    const subDir: TreeDir = { type: "dir", children: new Map() };
    const [newRoot, oldNode] = attachNode(root, ["folder"], subDir);
    expect(oldNode).toBeUndefined();
    expect(newRoot.children.get("folder")).toBe(subDir);
    expect(newRoot).not.toBe(root);
  });

  it("should attach a node deeply", () => {
    const root: TreeDir = {
      type: "dir",
      children: new Map([["outer", { type: "dir", children: new Map() }]]),
    };
    const blob: TreeBlob = { type: "blob", content: ["deep"] };
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
    const root: TreeDir = {
      type: "dir",
      children: new Map([["file.txt", { type: "blob", content: ["x"] }]]),
    };
    const newNode: TreeBlob = { type: "blob", content: ["y"] };
    expect(() => attachNode(root, ["file.txt", "sub"], newNode)).toThrow(
      "Path component is not a directory",
    );
  });
});

function expectIsDir(value: TreeNode | undefined): asserts value is TreeDir {
  expect(value?.type).toBe("dir");
}
