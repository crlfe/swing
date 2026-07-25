import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import readFileTool from "./read_file.ts";

describe("read_file", () => {
  let config: ChatConfig;
  let fs: FileTree;

  beforeEach(() => {
    config = {
      url: "",
      model: "",
      key: "",
      fs: new FileTree(),
      context: new ChatContext(),
      logText(_: string) {},
      logInfo(_: string) {},
      logThink(_: string) {},
    };
    fs = config.fs;
  });

  it("should read a file's content", async () => {
    fs.write("test.txt", ["hello world"]);
    const result = await readFileTool.execute({ path: "test.txt" }, config);
    expect(result).toContain("read test.txt (1 line)\nhello world");
  });

  it("should read a line range", async () => {
    fs.write("test.txt", ["alpha", "bravo", "charlie", "delta"]);
    const result = await readFileTool.execute(
      { path: "test.txt", startLine: 2, endLine: 3 },
      config,
    );
    expect(result).toBe("read test.txt (lines 2-3 of 4)\nbravo\ncharlie");
  });

  it("should read from the start when only endLine is given", async () => {
    fs.write("test.txt", ["a", "b", "c"]);
    const result = await readFileTool.execute({ path: "test.txt", endLine: 2 }, config);
    expect(result).toContain("read test.txt (lines 1-2 of 3)");
  });

  it("should return error for non-existent file", async () => {
    await expect(readFileTool.execute({ path: "ghost.txt" }, config)).rejects.toThrow(
      "Path not found",
    );
  });

  it("should reject invalid ranges", async () => {
    fs.write("test.txt", ["a", "b"]);
    await expect(
      readFileTool.execute({ path: "test.txt", startLine: 2, endLine: 1 }, config),
    ).rejects.toThrow("Invalid line range");
  });
});
