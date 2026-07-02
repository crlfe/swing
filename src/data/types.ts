export interface TreeDir {
  readonly type: "dir";
  readonly children: ReadonlyMap<string, TreeNode>;
}

export interface TreeBlob {
  readonly type: "blob";
  readonly content: readonly string[];
}

export type TreeNode = TreeDir | TreeBlob;

export interface Patch {
  readonly files: readonly PatchFile[];
}

export interface PatchFile {
  readonly oldPath: string;
  readonly newPath: string;
  readonly hunks: readonly PatchHunk[];
}

export interface PatchHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly oldLines: readonly string[];
  readonly newLines: readonly string[];
}
