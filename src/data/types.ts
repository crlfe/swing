export interface Dir {
  readonly type: "dir";
  readonly children: Map<string, Dir | Blob>;
}

export interface Blob {
  readonly type: "blob";
  readonly content: ReadonlyArray<string>;
}

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
