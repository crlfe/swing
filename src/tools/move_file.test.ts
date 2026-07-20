import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import moveFileTool from "./move_file.ts";

describe("move_file", () => {
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

  it("should move/rename a file", async () => {
    fs.write("old.txt", ["content"]);
    const result = await moveFileTool.execute({ oldPath: "old.txt", newPath: "new.txt" }, config);
    expect(result).toBe("moved old.txt to new.txt (new)");
    expect(fs.read("new.txt")).toEqual(["content"]);
    expect(fs.has("old.txt")).toBe(false);
  });

  it("should report overwrite when moving onto an existing blob", async () => {
    fs.write("f1.txt", ["1"]);
    fs.write("f2.txt", ["2"]);
    const result = await moveFileTool.execute({ oldPath: "f1.txt", newPath: "f2.txt" }, config);
    expect(result).toBe("moved f1.txt to f2.txt (overwrote)");
    expect(fs.read("f2.txt")).toEqual(["1"]);
  });

  it("should return error if destination dir exists", async () => {
    fs.write("f1.txt", ["1"]);
    fs.write("dir/x.txt", ["2"]);
    await expect(
      moveFileTool.execute({ oldPath: "f1.txt", newPath: "dir" }, config),
    ).rejects.toThrow("Destination already exists");
  });
});
