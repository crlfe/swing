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

export function renderSidebar(
  fs: FileTree,
  onOpen: (options: { label: string; content?: string[]; path?: string }) => Promise<void>,
  onRename: (li: HTMLElement, path: string) => void,
  onDelete: (path: string) => void,
): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  let list: HTMLElement;
  let fileItemsContainer: HTMLUListElement;
  sidebar.replaceChildren(
    h("div", { id: "sidebar-header" }, ["Files"]),
    (list = h(
      "div",
      {
        class: "file-list",
        style: { display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" },
      },
      [
        (fileItemsContainer = h(
          "ul",
          {
            style: "overflow: auto; flex: 1; list-style: none; padding: 0; margin: 0;",
            id: "file-items-container",
          },
          [],
        )),
      ],
    )),
    h("div", { id: "sidebar-actions" }),
  );

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
          fs.write(path, text.split("\n"));
          await onOpen({ label: path, path });
        }
        return;
      }

      const file = item.getAsFile();
      if (file) {
        const text = await file.text();
        fs.write(file.name, text.split("\n"));
        await onOpen({ label: file.name, path: file.name });
      }

      item.getAsString((text) => {
        console.log("TODO: Create untitled file for", text);
      });
    }
  });

  const collapsedDirs = new Set<string>();

  const updateTree = () => {
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
        const isCollapsed = isDir && collapsedDirs.has(path);

        const li = h(
          "li",
          {
            class: `file-item`,
            style: `padding-left: ${15 + level * 12}px`,
            ...(isDir
              ? {
                  onclick: () => {
                    if (collapsedDirs.has(path)) collapsedDirs.delete(path);
                    else collapsedDirs.add(path);
                    updateTree();
                  },
                }
              : {
                  "data-filename": path,
                  onclick: () => onOpen({ label: path.replace(/^.*\//, ""), path }),
                  ondblclick: (e: Event) => {
                    e.stopPropagation();
                    onRename(li, path);
                  },
                }),
          },
          [h("span", {}, [(isDir ? (isCollapsed ? "📁 " : "📂 ") : "📄 ") + name])],
        );

        fileItemsContainer.appendChild(li);
        if (isDir && !isCollapsed) renderTree(child, path, level + 1);
      });
    };

    fileItemsContainer.replaceChildren();
    renderTree(fs.getRoot());

    const actions = document.getElementById("sidebar-actions") as HTMLDivElement;
    if (!actions) return;

    actions.style =
      "margin-top:auto; display:flex; flex-direction:column; gap:0.5em; padding:0.5em;";

    actions.replaceChildren(
      h(
        "button",
        {
          onclick: () => {
            const path = prompt("Enter file name:");
            if (path) {
              fs.write(path, []);
              onOpen({ label: path, path: path });
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
            if (path && confirm(`Are you sure you want to delete ${path}?`)) onDelete(path);
          },
        },
        ["Delete Selected"],
      ),
      h(
        "button",
        {
          onclick: () => downloadProjectAsZip(fs),
        },
        ["Download Project (.zip)"],
      ),
      h("div", { style: "height: 0.5em" }),
      ...renderDevModeButtons(fs, onOpen),
      h(
        "button",
        {
          onclick: () => {
            if (
              confirm(
                "Are you sure you want to reset the project? All current changes will be lost.",
              )
            ) {
              fs.fromJSON(getExampleFiles());
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
            onOpen({
              label: "Licenses",
              content: import.meta.env.LICENSES?.split("\n"),
            });
          },
        },
        ["Show Licenses"],
      ),
    );
  };

  fs.watch("", updateTree, { recursive: true });
  updateTree();
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
    input.focus();
  }).finally(() => {
    li.replaceChildren(h("span", {}, [`📄 ${name}`]));
  });
}
