import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import searchFilesTool from "./search_files.ts";

describe("search_files", () => {
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

  it("should find files containing the query with line numbers", async () => {
    fs.write("f1.txt", ["apple pie"]);
    fs.write("f2.txt", ["banana cake"]);
    fs.write("f3.txt", ["apple tart"]);

    const result = await searchFilesTool.execute({ query: "apple" }, config);
    expect(result).toContain("f1.txt");
    expect(result).toContain("f3.txt");
    expect(result).not.toContain("f2.txt");
    expect(result).toContain("1: apple pie");
  });

  it("should return no results if query not found", async () => {
    fs.write("f1.txt", ["apple"]);
    const result = await searchFilesTool.execute({ query: "orange" }, config);
    expect(result).toContain(`searched files (0 matches for "orange")`);
  });
});
