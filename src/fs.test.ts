import { describe, it, expect, beforeEach } from "vitest";

import { Files } from "./fs.ts";

describe("Virtual File System", () => {
  let fs: Files;
  beforeEach(() => {
    // Reset the filesystem state before each test to ensure isolation
    fs = new Files();
    fs.fromJSON({
      "index.html": "<html><body>Hello</body></html>",
      "src/main.js": 'console.log("hello");',
    });
  });

  it("should read a file", () => {
    expect(fs.read("index.html")).toBe("<html><body>Hello</body></html>");
  });

  it("should throw error when reading non-existent file", () => {
    expect(() => fs.read("missing.txt")).toThrow("File not found: missing.txt");
  });

  it("should write a new file", () => {
    fs.write("test.txt", "hello world");
    expect(fs.read("test.txt")).toBe("hello world");
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
    const names = fs.listWithDirectoriesFirst();
    expect(names).toContain("index.html");
    expect(names).toContain("src/");
    expect(names).toContain("src/main.js");
  });
});
