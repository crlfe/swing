export interface TreeDir {
  readonly type: "dir";
  readonly children: Map<string, TreeNode>;
}

export interface TreeBlob {
  readonly type: "blob";
  readonly content: ReadonlyArray<string>;
}

export type TreeNode = TreeDir | TreeBlob;

export interface Patch {
  readonly files: PatchFile[];
}

export interface PatchFile {
  readonly oldPath: string;
  readonly newPath: string;
  readonly hunks: PatchHunk[];
}

export interface PatchHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly oldLines: string[];
  readonly newLines: string[];
}
