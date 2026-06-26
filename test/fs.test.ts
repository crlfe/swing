import { describe, it, expect, beforeEach } from "vitest";

import { fs } from "../src/fs.js";

describe("Virtual File System", () => {
  beforeEach(() => {
    // Reset the filesystem state before each test to ensure isolation
    fs.files = {
      "index.html": {
        type: "html",
        content: "<html><body>Hello</body></html>",
      },
      "src/main.js": {
        type: "js",
        content: 'console.log("hello");',
      },
    };
  });

  it("should read a file", () => {
    expect(fs.read("index.html")).toBe("<html><body>Hello</body></html>");
  });

  it("should throw error when reading non-existent file", () => {
    expect(() => fs.read("missing.txt")).toThrow("File not found: missing.txt");
  });

  it("should write a new file", () => {
    fs.write("test.txt", "hello world", "text");
    expect(fs.read("test.txt")).toBe("hello world");
    expect(fs.getFileType("test.txt")).toBe("text");
  });

  it("should update an existing file", () => {
    fs.write("index.html", "updated content");
    expect(fs.read("index.html")).toBe("updated content");
  });

  it("should delete a file", () => {
    fs.delete("index.html");
    expect(() => fs.read("index.html")).toThrow();
  });

  it("should throw error when deleting non-existent file", () => {
    expect(() => fs.delete("ghost.txt")).toThrow("File not found: ghost.txt");
  });

  it("should move a file", () => {
    fs.move("src/main.js", "src/app.js");
    expect(fs.read("src/app.js")).toBe('console.log("hello");');
    expect(() => fs.read("src/main.js")).toThrow();
  });

  it("should throw error when moving non-existent file", () => {
    expect(() => fs.move("void.txt", "target.txt")).toThrow("File not found: void.txt");
  });

  it("should throw error when moving to an existing path", () => {
    expect(() => fs.move("src/main.js", "index.html")).toThrow(
      "Destination already exists: index.html",
    );
  });

  it("should list directory tree correctly", () => {
    const tree = fs.list();
    // The fs.list() implementation flattens the tree for the root.
    // Check if we have nodes for our initial files.
    const names = tree.map((n) => n.name);
    expect(names).toContain("index.html");
    expect(names).toContain("src");
  });
});
