import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import deleteFileTool from "./delete_file.ts";

describe("delete_file", () => {
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

  it("should delete a file", async () => {
    fs.write("delete-me.txt", ["bye"]);
    const result = await deleteFileTool.execute({ path: "delete-me.txt" }, config);
    expect(result).toBe("deleted delete-me.txt");
    expect(fs.has("delete-me.txt")).toBe(false);
  });

  it("should return error for non-existent file", async () => {
    await expect(deleteFileTool.execute({ path: "ghost.txt" }, config)).rejects.toThrow(
      "Path not found",
    );
  });

  it("should delete non-empty directory recursively", async () => {
    fs.write("dir/nested.txt", ["x"]);
    const result = await deleteFileTool.execute({ path: "dir", recursive: true }, config);
    expect(result).toBe("deleted dir");
    expect(fs.has("dir")).toBe(false);
  });
});
