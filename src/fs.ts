export type FileTreeNode = {
  name: string;
  isDirectory: boolean;
  path: string;
  children: FileTreeNode[];
};

export class Files extends EventTarget {
  private readonly storageKey: string;
  private files: Record<string, { type: string; content: string }>;

  constructor(storageKey: string) {
    super();
    this.storageKey = storageKey;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        this.files = JSON.parse(saved);
      } catch (e) {
        console.error("Failed to load files from localStorage", e);
        this.files = getDefaultFiles();
      }
    } else {
      this.files = getDefaultFiles();
    }
  }

  private save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.files));
  }

  private emitChange(detail: any = {}) {
    this.dispatchEvent(new CustomEvent("change", { detail }));
  }

  list() {
    const paths = Object.keys(this.files).sort();
    const root: FileTreeNode = { name: "", isDirectory: true, path: "", children: [] as any[] };

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

    const flatten = (node: any, result: any[] = []) => {
      node.children.sort((a: any, b: any) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      node.children.forEach((child: any) => {
        result.push(child);
        if (child.isDirectory) flatten(child, result);
      });
      return result;
    };

    return flatten(root);
  }

  read(path: string): string {
    const file = this.files[path];
    if (!file) throw new Error(`File not found: ${path}`);
    return file.content;
  }

  write(path: string, content: string, type = "text"): void {
    if (this.files[path]) {
      this.files[path].content = content;
    } else {
      this.files[path] = { type, content };
    }
    this.save();
    this.emitChange({ type: "write", path });
  }

  delete(path: string): void {
    if (!this.files[path]) {
      throw new Error(`File not found: ${path}`);
    }
    delete this.files[path];
    this.save();
    this.emitChange({ type: "delete", path });
  }

  move(oldPath: string, newPath: string): void {
    if (!this.files[oldPath]) {
      throw new Error(`File not found: ${oldPath}`);
    }
    if (this.files[newPath]) {
      throw new Error(`Destination already exists: ${newPath}`);
    }

    const fileData = this.files[oldPath];
    this.files[newPath] = fileData;
    delete this.files[oldPath];
    this.save();
    this.emitChange({ type: "move", oldPath, newPath });
  }

  getFileType(path: string): string {
    return this.files[path]?.type || "text";
  }

  reset() {
    this.files = getDefaultFiles();
    this.save();
    this.emitChange({ type: "reset" });
  }
}

function getDefaultFiles() {
  return {
    "index.html": {
      type: "html",
      content: `<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="src/main.css">
</head>
<body>
    <h1>Welcome to Swing IDE</h1>
    <p>This is a real-time preview. Edit the files to see changes!</p>
    <div class="card">
        <p>The styling comes from <code>src/main.css</code></p>
        <button id="magic-btn">Click for Magic</button>
    </div>
    <script src="src/main.js"></script>
</body>
</html>`,
    },
    "src/main.css": {
      type: "css",
      content: `body {
    font-family: system-ui, sans-serif;
    background: #f0f2f5;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    margin: 0;
}

.card {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    text-align: center;
    max-width: 400px;
}

button {
    background: #007bff;
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 5px;
    cursor: pointer;
    font-weight: bold;
    transition: background 0.2s;
}

button:hover {
    background: #0056b3;
}`,
    },
    "src/main.js": {
      type: "js",
      content: `document.getElementById("magic-btn").onclick = () => {
    const colors = ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#a0c4ff", "#bdb2ff", "#ffc6ff"];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    document.body.style.backgroundColor = randomColor;
    console.log("Magic color applied!");
};`,
    },
  };
}
