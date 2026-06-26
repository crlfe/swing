import JSZip from "jszip";

import { type Files, type FileTreeNode } from "./fs";
import { h } from "./h";
import { state } from "./state";

interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
}

function resolvePath(currentPath: string, inputPath: string): string {
  if (inputPath.startsWith("/")) {
    return inputPath.substring(1);
  }
  if (inputPath.startsWith(".")) {
    const parts = currentPath.split("/");
    const segments = inputPath.split("/");
    for (const segment of segments) {
      if (segment === ".") continue;
      else if (segment === "..") parts.pop();
      else parts.push(segment);
    }
    return parts.join("/");
  }
  if (!inputPath.includes("/")) {
    const dir = currentPath.substring(0, currentPath.lastIndexOf("/"));
    return dir ? `${dir}/${inputPath}` : inputPath;
  }
  return inputPath;
}

async function downloadProjectAsZip(fs: Files) {
  try {
    const zip = new JSZip();
    const allFiles = Object.keys((fs as any).files);

    allFiles.forEach((path) => {
      const content = fs.read(path);
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
  fs: Files,
  onOpen: (file: FileInfo, isNew?: boolean) => void,
  onRename: (li: HTMLElement, file: FileInfo) => void,
  onDelete: (path: string) => void,
): void {
  const list = document.getElementById("file-list");
  if (!list) return;

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

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

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
          fs.write(path, text);
          state.updateViewContent(path, text);
          onOpen({ name: file.name, path, isDirectory: false });
        }
        return;
      }

      const file = item.getAsFile();
      if (file) {
        const text = await file.text();
        fs.write(file.name, text);
        state.updateViewContent(file.name, text);
        onOpen({ name: file.name, path: file.name, isDirectory: false });
      }

      item.getAsString((text) => {
        console.log("TODO: Create untitled file for", text);
      });
    }
  });

  const updateTree = () => {
    list.replaceChildren();

    const allFiles = Object.keys((fs as any).files).sort();
    const root: FileTreeNode = { name: "", children: [], isDirectory: true, path: "" };

    allFiles.forEach((path) => {
      const parts = path.split("/");
      let current = root;
      let accumulatedPath = "";
      parts.forEach((part, index) => {
        accumulatedPath += (accumulatedPath ? "/" : "") + part;
        const isLast = index === parts.length - 1;
        let child = current.children.find((c) => c.name === part);
        if (!child) {
          child = { name: part, path: accumulatedPath, isDirectory: !isLast, children: [] };
          current.children.push(child);
        }
        current = child;
      });
    });

    const sortChildren = (node: FileTreeNode): void => {
      if (!node.children) return;
      node.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach((child) => {
        if (child.isDirectory) sortChildren(child);
      });
    };
    sortChildren(root);

    const renderTree = (node: FileTreeNode, level = 0): void => {
      node.children.forEach((child) => {
        const li = h(
          "li",
          {
            class: "file-item",
            style: `padding-left: ${15 + level * 12}px`,
            ...(child.isDirectory
              ? {}
              : {
                  "data-filename": child.path,
                  onclick: () => onOpen(child as FileInfo),
                  ondblclick: (e: Event) => {
                    e.stopPropagation();
                    onRename(li, child as FileInfo);
                  },
                }),
          },
          [h("span", {}, [(child.isDirectory ? "📁 " : "📄 ") + child.name])],
        );

        list.appendChild(li);
        if (child.isDirectory) renderTree(child, level + 1);
      });
    };
    renderTree(root);

    const actions = h(
      "div",
      {
        class: "sidebar-actions",
        style: "margin-top:10px; display:flex; flex-direction:column; gap:5px; padding:0 5px;",
      },
      [
        h(
          "button",
          {
            class: "sidebar-btn",
            onclick: () => {
              const name = prompt("Enter file name:");
              if (name) onOpen({ name, path: name, isDirectory: false }, true);
            },
          },
          ["+ New File"],
        ),
        h(
          "button",
          {
            class: "sidebar-btn delete-btn",
            onclick: () => {
              const activeItem = document.querySelector(".file-item.active") as HTMLElement;
              if (!activeItem) return alert("Please select a file first");
              const path = activeItem.dataset.filename;
              if (path && confirm(`Are you sure you want to delete ${path}?`)) onDelete(path);
            },
          },
          ["🗑 Delete Selected"],
        ),
        h(
          "button",
          {
            class: "sidebar-btn",
            onclick: () => downloadProjectAsZip(fs),
          },
          ["📦 Download Project (.zip)"],
        ),
        h(
          "button",
          {
            class: "sidebar-btn reset-btn",
            style: "color: #c0392b",
            onclick: () => {
              if (
                confirm(
                  "Are you sure you want to reset the project to default? All current changes will be lost.",
                )
              ) {
                fs.reset();
                location.reload();
              }
            },
          },
          ["🔄 Reset Project"],
        ),
      ],
    );

    list.appendChild(actions);
  };

  fs.addEventListener("change", updateTree);
  updateTree();
}

export function enterRenameMode(
  li: HTMLElement,
  file: FileInfo,
  onSave: (file: FileInfo, newValue: string) => void,
): void {
  const input = h("input", {
    type: "text",
    value: file.name,
    style: "font-size:12px; width:80px;",
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") {
        isSaved = true;
        save();
      }
    },
    onblur: () => save(),
  }) as HTMLInputElement;

  li.replaceChildren(input);
  input.focus();

  let isSaved = false;
  function save(): void {
    if (isSaved) return;
    isSaved = true;
    const val = input.value.trim();
    if (val && val !== file.name) {
      onSave(file, val);
    }
  }
}

export { resolvePath };
