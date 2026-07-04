# Data Layer

This directory contains the core data structures and algorithms for managing a virtual file system,
computing diffs, and applying patches.

## `FileTree` (`src/data/file-tree.ts`)

A class representing a virtual file system tree using forward-slash paths.

- `constructor(root?: TreeDir)`: Initializes a new FileTree.
- `get size(): number`: Returns the total number of files (blobs) in the tree.
- `getRoot(): TreeDir`: Returns the root directory of the tree.
- `read(path: string): ReadonlyArray<string>`: Reads the content of a file.
- `write(path: string, content: ReadonlyArray<string>): boolean`: Writes content to a file.
- `delete(path: string, options?: { recursive?: boolean }): void`: Deletes a file or directory.
- `move(oldPath: string, newPath: string): void`: Moves or renames a file/directory.
- `list(): string[]`: Lists all paths in the tree.
- `listWithDirectoriesFirst(): string[]`: Lists all paths, sorting directories before files.
- `walk(path: string, callback: (path: string, node: TreeNode) => boolean | undefined | void): void`:
  Synchronously walks the tree.
- `walkAsync(path: string, callback: (path: string, node: TreeNode) => Promise<boolean | undefined | void>): Promise<void>`:
  Asynchronously walks the tree.
- `watch(path: string, callback: (path: string) => void, options: { recursive?: boolean } = {}): () => void`:
  Watches a path for changes.
- `fromJSON(json: RecursiveRecord<string, string>): void`: Populates the tree from a nested object.
- `toJSON(): RecursiveRecord<string, string>`: Converts the tree to a nested object.
- `has(path: string): boolean`: Checks if a path exists.
- `getNode(path: string): TreeNode`: Retrieves the node at a given path.
- `clear(): void`: Resets the tree to an empty state.

## Diffing & Patching

### `src/data/diff.ts`

- `diffTree(oldTree: TreeDir, newTree: TreeDir): Patch`: Computes the difference between two tree
  structures.

### `src/data/diff-myers.ts`

- `diffLinesMyers(oldLines: readonly string[], newLines: readonly string[]): PatchHunk[]`:
  Implements Myers' Diff Algorithm to find the shortest edit script between two arrays of lines.

### `src/data/patch.ts`

- `patchLines(lines: readonly string[], hunks: readonly PatchHunk[]): string[]`: Applies a set of
  line-based hunks to a list of lines.
- `patchTree(root: TreeDir, patch: Patch): TreeDir`: Applies a `Patch` to a `TreeDir` to produce a
  new `TreeDir`.

## Types (`src/data/types.ts`)

All the following types are designed to be immutable.

- `TreeNode`: Union of `TreeDir` and `TreeBlob`.
- `TreeDir`: A directory containing a map of children.
- `TreeBlob`: A file containing an array of lines.
- `Patch`: A collection of `PatchFile` objects.
- `PatchFile`: Contains the old and new paths and the `PatchHunk`s for a specific file.
- `PatchHunk`: Represents a specific change (old/new lines and their start indices).

## Tree Utilities (`src/data/trees.ts`)

Low-level functions for manipulating `TreeNode` structures.

- `splitPath(path: string): string[]`: Normalizes and splits a path string into segments.
- `walkDown(root: TreeDir, parts: string[]): [TreeDir[], TreeNode | undefined]`: Traverses down the
  tree to a specific path.
- `attachNode(root: TreeDir, parts: string[], newNode: TreeNode): [TreeDir, TreeNode | undefined]`:
  Inserts a node into the tree, returning the new root and the replaced node.
- `detachNode(root: TreeDir, parts: string[]): [TreeDir, TreeNode | undefined]`: Removes a node from
  the tree, returning the new root and the detached node.
- `nodeFromObject(src: string | RecursiveRecord<string, string>): TreeNode`: Converts a JSON-like
  object (string for blob, record for directory) to a `TreeNode`.
- `nodeToObject(src: TreeNode): string | RecursiveRecord<string, string>`: Converts a `TreeNode`
  back to a JSON-like object.
