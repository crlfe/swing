import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import writeFileTool from "./write_file.ts";

describe("write_file", () => {
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

  it("should write content to a file", async () => {
    const result = await writeFileTool.execute({ path: "new.txt", content: "content" }, config);
    expect(result).toBe("wrote new.txt (new)");
    expect(fs.read("new.txt")).toEqual(["content"]);
  });

  it("should update existing file", async () => {
    fs.write("test.txt", ["old"]);
    const result = await writeFileTool.execute({ path: "test.txt", content: "new" }, config);
    expect(result).toBe("wrote test.txt (updated)");
    expect(fs.read("test.txt")).toEqual(["new"]);
  });

  it("should report unchanged when content is identical", async () => {
    fs.write("test.txt", ["same"]);
    const result = await writeFileTool.execute({ path: "test.txt", content: "same" }, config);
    expect(result).toBe("wrote test.txt (unchanged)");
  });

  it("should refuse to overwrite with ifExists=error", async () => {
    fs.write("test.txt", ["old"]);
    await expect(
      writeFileTool.execute({ path: "test.txt", content: "new", ifExists: "error" }, config),
    ).rejects.toThrow("File already exists");
  });

  it("should append with ifExists=append", async () => {
    fs.write("test.txt", ["old"]);
    await writeFileTool.execute({ path: "test.txt", content: "new", ifExists: "append" }, config);
    expect(fs.read("test.txt")).toEqual(["old", "new"]);
  });
});
