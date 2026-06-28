import { describe, it, expect, beforeEach } from "vitest";

import { Files } from "../fs.ts";
import readToplevelTool from "./read_toplevel.ts";

describe("readToplevelTool", () => {
  let fs: Files;

  beforeEach(() => {
    fs = new Files();
    fs.write(
      "test.ts",
      `\
import { Tool } from "./types.ts";

export class MyClass {
  constructor() {}

  methodOne() {
    console.log("doing something");
  }

  methodTwo() {
    console.log("doing something else");
  }
}

const myVar = 10;

export function myFunc() {
  return true;
}
`,
    );
  });

  it("should extract non-indented lines (toplevel)", async () => {
    const args = {
      path: "test.ts",
    };
    const result = await readToplevelTool.execute(args, { fs });

    // Expected toplevel:
    // import { Tool } from "./types.ts";
    //
    // export class MyClass {
    // }
    //
    // const myVar = 10;
    //
    // export function myFunc() {
    // }

    expect(result).toContain('import { Tool } from "./types.ts";');
    expect(result).toContain("export class MyClass {");
    expect(result).toContain("}");
    expect(result).toContain("const myVar = 10;");
    expect(result).toContain("export function myFunc() {");
    expect(result).toContain("}");

    // Should NOT contain indented lines
    expect(result).not.toContain("  constructor() {}");
    expect(result).not.toContain("  methodOne() {");
    expect(result).not.toContain('    console.log("doing something");');
  });

  it("should return error message if file does not exist", async () => {
    const args = {
      path: "non_existent.ts",
    };
    const result = await readToplevelTool.execute(args, { fs });
    expect(result).toSatisfy((m) => m.startsWith("Error reading file non_existent.ts"));
  });

  it("should handle empty files", async () => {
    fs.write("empty.ts", "");
    const args = {
      path: "empty.ts",
    };
    const result = await readToplevelTool.execute(args, { fs });
    expect(result).toBe("");
  });
});
