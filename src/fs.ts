export type FileTreeNode = {
  name: string;
  isDirectory: boolean;
  path: string;
  children: FileTreeNode[];
};

export class Files extends EventTarget {
  private files = new Map<string, string>();

  private emitChange(detail: any = {}) {
    this.dispatchEvent(new CustomEvent("change", { detail }));
  }

  get size() {
    return this.files.size;
  }

  fromJSON(json: Record<string, string>) {
    this.files = new Map(Object.entries(json));
    this.emitChange({ type: "import" });
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  getTree(): FileTreeNode {
    const paths = Array.from(this.files.keys()).sort();
    const root: FileTreeNode = { name: "", isDirectory: true, path: "", children: [] };

    paths.forEach((path) => {
      const parts = path.split("/");
      let current = root;
      let currentPath = "";

      parts.forEach((part, index) => {
        currentPath += (currentPath ? "/" : "") + part;
        const isLast = index === parts.length - 1;

        let node = current.children.find((c) => c.name === part);
        if (!node) {
          node = {
            name: part,
            path: currentPath,
            isDirectory: !isLast,
            children: [],
          };
          current.children.push(node);
        }
        current = node;
      });
    });

    const sortChildren = (node: FileTreeNode) => {
      node.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortChildren);
    };

    sortChildren(root);
    return root;
  }

  list(): string[] {
    const root = this.getTree();
    const result: string[] = [];
    const flatten = (node: FileTreeNode) => {
      node.children.forEach((child) => {
        result.push(child.isDirectory ? child.path + "/" : child.path);
        if (child.isDirectory) flatten(child);
      });
    };

    flatten(root);
    return result;
  }

  read(path: string): string {
    if (typeof path !== "string") throw new TypeError("missing path");
    const content = this.files.get(path);
    if (content == null) throw new Error(`File not found: ${path}`);
    return content;
  }

  write(path: string, content: string): void {
    if (typeof path !== "string" || !path) throw new TypeError("missing path");
    if (typeof content !== "string") throw new TypeError("missing content");
    this.files.set(path, content);
    this.emitChange({ type: "write", path });
  }

  delete(path: string): void {
    if (typeof path !== "string" || !path) throw new TypeError("missing path");
    if (!this.files.get(path)) {
      throw new Error(`File not found: ${path}`);
    }
    this.files.delete(path);
    this.emitChange({ type: "delete", path });
  }

  move(oldPath: string, newPath: string): void {
    if (typeof oldPath !== "string" || !oldPath) throw new TypeError("missing oldPath");
    if (typeof newPath !== "string" || !newPath) throw new TypeError("missing newPath");
    const fileData = this.files.get(oldPath);
    if (fileData == undefined) {
      throw new Error(`File not found: ${oldPath}`);
    }
    if (this.files.has(newPath)) {
      throw new Error(`Destination already exists: ${newPath}`);
    }

    this.files.set(newPath, fileData);
    this.files.delete(oldPath);
    this.emitChange({ type: "move", oldPath, newPath });
  }

  clear() {
    this.files.clear();
    this.emitChange({ type: "clear" });
  }
}
