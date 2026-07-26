import type { FileTree } from "./data/file-tree.ts";
import type { TreeDir } from "./data/types.ts";
import { getExampleFiles } from "./fs-example.ts";
import { h } from "./h.ts";
import { renderDevModeButtons } from "./ui-sidebar-dev.ts";

async function downloadProjectAsZip(fs: FileTree) {
  try {
    const JSZip = await import("jszip").then((m) => m.default);
    const zip = new JSZip();
    const allFiles = fs.list();

    allFiles.forEach((path) => {
      const content = fs.read(path)?.join("\n") ?? "";
      zip.file(path, content);
    });

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;

    const a = h("a", { href: url, download: `project-${timestamp}.zip` });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert("Failed to download project as zip");
  }
}

export class SidebarView {
  readonly view: HTMLElement;
  private fileItemsContainer: HTMLUListElement;
  private actionsContainer: HTMLDivElement;
  private collapsedDirs = new Set<string>();

  constructor(
    private fs: FileTree,
    private onOpen: (options: {
      label: string;
      content?: string[];
      path?: string;
    }) => Promise<void>,
    private onRename: (li: HTMLElement, path: string) => void,
    private onDelete: (path: string) => void,
  ) {
    this.fileItemsContainer = h(
      "ul",
      {
        style: "overflow: auto; flex: 1; list-style: none; padding: 0; margin: 0;",
        id: "file-items-container",
      },
      [],
    );

    this.actionsContainer = h("div", { id: "sidebar-actions" });

    const list = h(
      "div",
      {
        class: "file-list",
        style: { display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" },
      },
      [this.fileItemsContainer],
    );

    this.view = h("div", { id: "sidebar" }, [
      h("div", { id: "sidebar-header" }, ["Files"]),
      list,
      this.actionsContainer,
    ]);

    this.setupDragAndDrop(list);
    this.fs.watch("", () => this.#render(), { recursive: true });
    this.#render();
  }

  private setupDragAndDrop(list: HTMLElement) {
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      list.classList.add("drag-over");
    });

    list.addEventListener("dragleave", () => {
      list.classList.remove("drag-over");
    });

    list.addEventListener("drop", async (e) => {
      e.preventDefault();
      list.classList.remove("drag-over");

      const items = e.dataTransfer?.items;
      if (!items) return;

      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          async function* walk(
            prefix: string,
            entries: FileSystemEntry[],
          ): AsyncGenerator<[string, File]> {
            for (const entry of entries) {
              if (entry.isDirectory) {
                const children = await new Promise<FileSystemEntry[]>((resolve, reject) => {
                  (entry as FileSystemDirectoryEntry).createReader().readEntries(resolve, reject);
                });
                yield* walk(`${prefix}${entry.name}/`, children);
              } else {
                const file = await new Promise<File>((resolve, reject) => {
                  (entry as FileSystemFileEntry).file(resolve, reject);
                });
                yield [prefix + file.name, file];
              }
            }
          }
          for await (const [path, file] of walk("", [entry])) {
            const text = await file.text();
            this.fs.write(path, text.split("\n"));
            await this.onOpen({ label: path, path });
          }
          return;
        }

        const file = item.getAsFile();
        if (file) {
          const text = await file.text();
          this.fs.write(file.name, text.split("\n"));
          await this.onOpen({ label: file.name, path: file.name });
        } else {
          const text = await new Promise<string>((resolve) => {
            item.getAsString(resolve);
          });
          if (text) {
            const name = `untitled-${Date.now()}.txt`;
            this.fs.write(name, text.split("\n"));
            await this.onOpen({ label: name, path: name });
          }
        }
      }
    });
  }

  #render(): void {
    const renderTree = (node: TreeDir, currentPath = "", level = 0): void => {
      const entries = Array.from(node.children.entries());
      entries.sort(([aName, aChild], [bName, bChild]) => {
        if (aChild.type === "dir" && bChild.type !== "dir") return -1;
        if (aChild.type !== "dir" && bChild.type === "dir") return 1;
        return aName.localeCompare(bName);
      });

      entries.forEach(([name, child]) => {
        const path = currentPath ? `${currentPath}/${name}` : name;
        const isDir = child.type === "dir";
        const isCollapsed = isDir && this.collapsedDirs.has(path);

        const li = h(
          "li",
          {
            class: `file-item`,
            style: `padding-left: ${15 + level * 12}px`,
            ...(isDir
              ? {
                  onclick: () => {
                    if (this.collapsedDirs.has(path)) this.collapsedDirs.delete(path);
                    else this.collapsedDirs.add(path);
                    this.#render();
                  },
                }
              : {
                  "data-filename": path,
                  onclick: () => this.onOpen({ label: path.replace(/^.*\//, ""), path }),
                  ondblclick: (e: Event) => {
                    e.stopPropagation();
                    this.onRename(li, path);
                  },
                }),
          },
          [h("span", {}, [(isDir ? (isCollapsed ? "📁 " : "📂 ") : "📄 ") + name])],
        );

        this.fileItemsContainer.appendChild(li);
        if (isDir && !isCollapsed) renderTree(child, path, level + 1);
      });
    };

    this.fileItemsContainer.replaceChildren();
    renderTree(this.fs.getRoot());

    this.actionsContainer.style =
      "margin-top:auto; display:flex; flex-direction:column; gap:0.5em; padding:0.5em;";

    this.actionsContainer.replaceChildren(
      h(
        "button",
        {
          onclick: () => {
            const path = prompt("Enter file name:");
            if (path) {
              this.fs.write(path, []);
              this.onOpen({ label: path, path: path });
            }
          },
        },
        ["New File"],
      ),
      h(
        "button",
        {
          onclick: () => {
            const activeItem = document.querySelector(".file-item.active") as HTMLElement;
            if (!activeItem) return alert("Please select a file first");
            const path = activeItem.dataset.filename;
            if (path && confirm(`Are you sure you want to delete ${path}?`)) this.onDelete(path);
          },
        },
        ["Delete Selected"],
      ),
      h(
        "button",
        {
          onclick: () => downloadProjectAsZip(this.fs),
        },
        ["Download Project (.zip)"],
      ),
      h("div", { style: "height: 0.5em" }),
      ...renderDevModeButtons(this.fs, this.onOpen),
      h(
        "button",
        {
          onclick: () => {
            if (
              confirm(
                "Are you sure you want to reset the project? All current changes will be lost.",
              )
            ) {
              this.fs.fromJSON(getExampleFiles());
              location.reload();
            }
          },
        },
        ["Reset Project"],
      ),
      h(
        "button",
        {
          onclick: () => {
            if (
              confirm(
                "Are you sure you want to clear all data? This will delete everything in localStorage and reload the page.",
              )
            ) {
              localStorage.clear();
              location.reload();
            }
          },
        },
        ["Clear All State"],
      ),
      h(
        "button",
        {
          onclick: () => {
            this.onOpen({
              label: "Licenses",
              content: import.meta.env.LICENSES?.split("\n"),
            });
          },
        },
        ["Show Licenses"],
      ),
    );
  }
}

export async function enterRenameMode(li: HTMLElement, path: string): Promise<string> {
  const name = path.replace(/^.*\//, "");

  return new Promise<string>((resolve) => {
    const input = h("input", {
      type: "text",
      value: name,
      style: "font-size:12px; width:80px;",
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === "Enter") resolve(input.value.trim());
        if (e.key === "Escape") {
          resolve(path);
        }
      },
      onblur: () => resolve(input.value.trim()),
    }) as HTMLInputElement;

    li.replaceChildren(input);
    input.select();
  }).finally(() => {
    li.replaceChildren(h("span", {}, [`📄 ${name}`]));
  });
}
