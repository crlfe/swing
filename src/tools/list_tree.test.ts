import { describe, it, expect } from "vitest";

import listTreeTool from "./list_tree.ts";

describe("listDirectoryTreeTool", () => {
  const mockFs = {
    getTree: () => ({
      name: "",
      isDirectory: true,
      path: "",
      children: [],
    }),
  };

  it("should return 'The directory is empty.' for an empty directory", async () => {
    const result = await listTreeTool.execute({}, { fs: mockFs as any });
    expect(result).toBe("The directory is empty.");
  });

  it("should return a directory tree structure for a directory with files", async () => {
    const mockTree = {
      name: "",
      isDirectory: true,
      path: "",
      children: [
        { name: "file1.txt", isDirectory: false, path: "file1.txt", children: [] },
        { name: "file2.txt", isDirectory: false, path: "file2.txt", children: [] },
      ],
    };

    const result = await listTreeTool.execute({}, { fs: { getTree: () => mockTree } as any });
    expect(result).toBe("├── file1.txt\n└── file2.txt");
  });

  it("should return a directory tree structure for nested directories", async () => {
    const mockTree = {
      name: "",
      isDirectory: true,
      path: "",
      children: [
        {
          name: "src",
          isDirectory: true,
          path: "src",
          children: [
            { name: "main.ts", isDirectory: false, path: "src/main.ts", children: [] },
            { name: "utils.ts", isDirectory: false, path: "src/utils.ts", children: [] },
          ],
        },
        { name: "README.md", isDirectory: false, path: "README.md", children: [] },
      ],
    };

    const result = await listTreeTool.execute({}, { fs: { getTree: () => mockTree } as any });
    const expected = "├── src\n│   ├── main.ts\n│   └── utils.ts\n└── README.md";
    expect(result).toBe(expected);
  });

  it("should return an error message if getTree throws an error", async () => {
    const errorFs = {
      getTree: () => {
        throw new Error("Filesystem error");
      },
    };

    const result = await listTreeTool.execute({}, { fs: errorFs as any });
    expect(result).toBe("Error listing directory tree: Filesystem error");
  });
});
