import { beforeEach, describe, expect, it } from "vitest";

import type { ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import editLinesTool from "./edit_lines.ts";

describe("edit_lines", () => {
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

  it("should replace multiple matched lines (mode=replace)", async () => {
    fs.write("test.txt", ["line 1", "line 2", "line 3", "line 4"]);
    const result = await editLinesTool.execute(
      {
        path: "test.txt",
        search: "line 2\nline 3",
        content: "new line 2\nnew line 3",
        mode: "replace",
      },
      config,
    );

    expect(result).toContain(`edited test.txt (lines 2-3 replaced)`);
    expect(fs.read("test.txt")).toEqual(["line 1", "new line 2", "new line 3", "line 4"]);
  });

  it("should replace matched lines (mode=replace)", async () => {
    fs.write("test.txt", ["Hello World", "This is a test"]);
    const result = await editLinesTool.execute(
      {
        path: "test.txt",
        search: "Hello World",
        content: "Hello Vitest",
        mode: "replace",
      },
      config,
    );

    expect(result).toContain(`edited test.txt (line 1 replaced)`);
  });

  it("should be resilient to indentation (trimmed match)", async () => {
    fs.write("test.ts", ["function test() {", "  console.log('hi');", "}"]);
    const result = await editLinesTool.execute(
      {
        path: "test.ts",
        search: "console.log('hi');",
        content: "  console.log('hello');",
        mode: "replace",
      },
      config,
    );

    expect(result).toContain(`edited test.ts (line 2 replaced)`);
  });

  it("should default to replace mode", async () => {
    fs.write("test.txt", ["a", "b"]);
    await editLinesTool.execute({ path: "test.txt", search: "b", content: "B" }, config);
    expect(fs.read("test.txt")).toEqual(["a", "B"]);
  });

  it("should insert before the match (mode=before)", async () => {
    fs.write("test.txt", ["start", "middle", "end"]);
    const result = await editLinesTool.execute(
      {
        path: "test.txt",
        content: "inserted",
        search: "middle",
        mode: "before",
      },
      config,
    );
    expect(result).toContain(`edited test.txt (inserted before line 2)`);
    expect(fs.read("test.txt")).toEqual(["start", "inserted", "middle", "end"]);
  });

  it("should insert after the match (mode=after)", async () => {
    fs.write("test.txt", ["start", "middle", "end"]);
    const result = await editLinesTool.execute(
      {
        path: "test.txt",
        content: "inserted",
        search: "middle",
        mode: "after",
      },
      config,
    );
    expect(result).toContain(`edited test.txt (inserted after line 2)`);
    expect(fs.read("test.txt")).toEqual(["start", "middle", "inserted", "end"]);
  });

  it("should return error if search string not found", async () => {
    fs.write("test.txt", ["hello"]);
    await expect(
      editLinesTool.execute(
        {
          path: "test.txt",
          content: "world",
          search: "ghost",
          mode: "after",
        },
        config,
      ),
    ).rejects.toThrow("Search string not found");
  });

  it("should return error on multiple matches for replace mode", async () => {
    fs.write("test.txt", ["dup", "dup"]);
    await expect(
      editLinesTool.execute(
        {
          path: "test.txt",
          search: "dup",
          content: "x",
          mode: "replace",
        },
        config,
      ),
    ).rejects.toThrow("Multiple matches found");
  });
});
