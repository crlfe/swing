import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import listFilesTool from "./list_files.ts";

describe("list_files", () => {
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

  it("should list files in the root directory", async () => {
    fs.write("file1.txt", ["1"]);
    fs.write("dir1/file2.txt", ["2"]);

    const result = await listFilesTool.execute({ path: "" }, config);
    expect(result).toContain("file1.txt");
    expect(result).toContain("dir1/");
  });

  it("should list files in a subdirectory", async () => {
    fs.write("dir1/file2.txt", ["2"]);
    fs.write("dir1/file3.txt", ["3"]);

    const result = await listFilesTool.execute({ path: "dir1" }, config);
    expect(result).toContain("file2.txt");
    expect(result).toContain("file3.txt");
  });

  it("should tolerate a leading slash", async () => {
    fs.write("file1.txt", ["1"]);
    await expect(listFilesTool.execute({ path: "/file1.txt" }, config)).rejects.toThrow(
      "Path is not a directory",
    );
  });

  it("should return error for non-existent path", async () => {
    await expect(listFilesTool.execute({ path: "ghost" }, config)).rejects.toThrow(
      "Path not found",
    );
  });

  it("should return error if path is a file", async () => {
    fs.write("file1.txt", ["1"]);
    await expect(listFilesTool.execute({ path: "file1.txt" }, config)).rejects.toThrow(
      "Path is not a directory",
    );
  });
});
