import { describe, it, expect } from "vitest";

import { resolvePath } from "./util.ts";

describe("resolvePath", () => {
  it("should handle absolute paths (starting with /)", () => {
    expect(resolvePath("src/main.ts", "/home/user/test.txt")).toBe("home/user/test.txt");
    expect(resolvePath("any/path", "/root.ts")).toBe("root.ts");
  });

  it("should handle relative paths with dot segments", () => {
    // Current directory
    expect(resolvePath("src/utils/", "./helper.ts")).toBe("src/utils/helper.ts");

    // Parent directory
    expect(resolvePath("src/utils/helper.ts", "..")).toBe("src");
    expect(resolvePath("src/utils/helper.ts", "../main.ts")).toBe("src/main.ts");

    // Complex relative paths
    expect(resolvePath("src/components/ui/button.ts", "../../index.ts")).toBe("src/index.ts");
    expect(resolvePath("src/components/ui/button.ts", "../../../main.ts")).toBe("main.ts");
    expect(resolvePath("src/main.ts", "./dir/subdir/file.ts")).toBe("src/dir/subdir/file.ts");
    expect(resolvePath("src/main.ts", "../../../out.txt")).toBe("out.txt"); // going beyond root
  });

  it("should handle simple file renames (no slashes in input)", () => {
    // Rename file in same directory
    expect(resolvePath("src/utils/helper.ts", "new_helper.ts")).toBe("src/utils/new_helper.ts");

    // Rename file in root
    expect(resolvePath("main.ts", "index.ts")).toBe("index.ts");
  });

  it("should handle paths with slashes that are not absolute or dot-relative", () => {
    // Treat as replacement path
    expect(resolvePath("src/main.ts", "new/path/file.ts")).toBe("new/path/file.ts");
  });
});
