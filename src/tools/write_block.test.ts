import { describe, it, expect, beforeEach } from "vitest";

import { Files } from "../fs.ts";
import readBlockTool from "./read_block.ts";
import writeBlockTool from "./write_block.ts";

describe("readBlockTool and writeBlockTool with blank lines", () => {
  let fs: Files;

  beforeEach(() => {
    fs = new Files();
    fs.write(
      "test_blank.ts",
      `\
function testFunction() {
  const x = 1;

  const y = 2;
  return x + y;
}

function anotherFunction() {
  console.log("another");
}
`,
    );
  });

  it("should extract a block correctly even with blank lines in the middle", async () => {
    const args = {
      path: "test_blank.ts",
      searchLine: "function testFunction() {",
    };
    const result = await readBlockTool.execute(args, { fs });

    const expectedResult = "  const x = 1;\n\n  const y = 2;\n  return x + y;";
    expect(result).toBe(expectedResult);
  });

  it("should replace a logical block correctly even with blank lines in the middle", async () => {
    const args = {
      path: "test_blank.ts",
      searchLine: "function testFunction() {",
      newContent: "  const x = 10;\n  const y = 20;\n  return x + y;",
    };
    const result = await writeBlockTool.execute(args, { fs });

    expect(result).toBe("Successfully wrote block in test_blank.ts");

    const content = fs.read("test_blank.ts");
    expect(content).toContain("const x = 10;");
    expect(content).toContain("const y = 20;");
    expect(content).not.toContain("const x = 1;");
    expect(content).not.toContain("const y = 2;");
  });
});
