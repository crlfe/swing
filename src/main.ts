import { FileTree } from "./data/file-tree.ts";
import { createEditor } from "./editor.ts";
import { getExampleFiles } from "./fs-example.ts";
import { state } from "./state.ts";
import { enterRenameMode, renderSidebar, resolvePath } from "./ui-sidebar.ts";
import { activateTab, addTab, removeTabUI, updateTabLabel } from "./ui-tabs.ts";
import { ChatView } from "./view/chat.ts";

const fs = new FileTree();
{
  const STORAGE_KEY = "swing_editor_files";
  const STORAGE_VERSION = 1;

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.version === STORAGE_VERSION) {
        fs.fromJSON(parsed.files);
      } else {
        console.error("Ignoring incompatible saved project");
        fs.fromJSON(getExampleFiles());
      }
    } catch (e) {
      console.error("Failed to load files from localStorage", e);
    }
  } else {
    fs.fromJSON(getExampleFiles());
  }

  fs.watch(
    "",
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, files: fs.toJSON() }),
      );
    },
    { recursive: true },
  );
}

function switchTab(fileName: string): void {
  state.setActiveTab(fileName);
  activateTab(fileName);
  document.querySelectorAll(".file-item").forEach((item) => {
    const el = item as HTMLElement;
    el.classList.toggle("active", el.dataset.filename === fileName);
  });
  const view = state.getView(fileName);
  if (view) {
    view.requestMeasure();
  }
}

async function handleFileOpen(
  id: string,
  options: { label: string; content?: string[]; path?: string },
): Promise<void> {
  const { label, content: initialContent, path } = options;

  if (path && initialContent) {
    fs.write(path, initialContent);
  }

  if (!state.getView(id)) {
    const container = addTab(id, label, switchTab, () => {
      removeTabUI(id);
      const view = state.getView(id);
      if (view) {
        view.destroy();
        state.unregisterView(id);
      }
      if (state.activeId === id) {
        const tabs = document.querySelectorAll(".tab-btn");
        if (tabs.length > 0) {
          const firstTab = tabs[0] as HTMLElement;
          switchTab(firstTab.id.replace("btn-", ""));
        }
      }
    });

    const view = await createEditor(
      id,
      (path ? fs.read(path) : (initialContent ?? [])).join("\n"),
      (content: string) => {
        if (path) {
          fs.write(path, content.split("\n"));
        }
      },
      container,
    );
    state.registerView(id, view);

    if (path) {
      const unwatch = fs.watch(path, () => {
        if (!fs.has(path)) {
          unwatch();
          return;
        }
        state.updateViewContent(id, fs.read(path).join("\n"));
      });
    }
  }
  switchTab(id);
}

function handleRename(li: HTMLElement, path: string): void {
  enterRenameMode(li, path, (oldPath: string, newValue: string) => {
    const newPath = resolvePath(oldPath, newValue);
    try {
      fs.move(oldPath, newPath);
      const view = state.getView(oldPath);
      if (view) {
        state.unregisterView(oldPath);
        state.registerView(newPath, view);
        updateTabLabel(oldPath, newPath, newPath.split("/").pop() || "");
        const btn = document.getElementById(`btn-${newPath}`);
        if (btn) btn.onclick = () => switchTab(newPath);
      }
      if (state.activeId === oldPath) state.setActiveTab(newPath);
    } catch (e: any) {
      alert(e.message);
    }
  });
}

function handleDelete(path: string): void {
  try {
    fs.delete(path);
    removeTabUI(path);
    const view = state.getView(path);
    if (view) {
      view.destroy();
      state.unregisterView(path);
    }
  } catch (e: any) {
    alert(e.message);
  }
}

function initSidebar(): void {
  renderSidebar(fs, handleFileOpen, handleRename, handleDelete);
}

initSidebar();

const chatView = new ChatView(fs);
document.getElementById("main-content")?.appendChild(chatView.view);
