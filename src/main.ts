import { FileTree } from "./data/file-tree.ts";
import { EditorTab } from "./editor.ts";
import { getExampleFiles } from "./fs-example.ts";
import { AppState } from "./state.ts";
import { enterRenameMode, renderSidebar } from "./ui-sidebar.ts";
import { activateTab, addTab, removeTabUI, updateTabLabel } from "./ui-tabs.ts";
import { resolvePath } from "./util.ts";
import { ChatView } from "./view/chat.ts";

const state = new AppState();
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

function switchTab(id: string): void {
  state.setActive(id);
  activateTab(id);
  document.querySelectorAll(".file-item").forEach((item) => {
    const el = item as HTMLElement;
    el.classList.toggle("active", el.dataset.filename === id);
  });
  const tab = state.getById(id);
  if (tab instanceof EditorTab) {
    tab.view.then((view) => view.requestMeasure());
  }
}

async function handleFileOpen(options: {
  label: string;
  content?: string[];
  path?: string;
}): Promise<void> {
  const { label, content: initialContent, path } = options;

  let tab = path !== undefined ? state.getByPath(path) : undefined;
  if (!tab) {
    const id = state.nextTabId();
    const container = addTab(id, label, switchTab, () => {
      removeTabUI(id);
      const tab = state.getById(id);
      if (tab) {
        if (tab instanceof EditorTab) {
          tab.destroy();
          state.delete(id);
        }
      }
      if (state.active === id) {
        const tabs = document.querySelectorAll(".tab-btn");
        if (tabs.length > 0) {
          const firstTab = tabs[0] as HTMLElement;
          switchTab(firstTab.id.replace("btn-", ""));
        }
      }
    });

    const content = (path ? fs.read(path) : (initialContent ?? [])).join("\n");
    tab = new EditorTab(id, path, label, content, container, fs);
    state.add(tab);
  }
  switchTab(tab.id);
}

function handleRename(li: HTMLElement, path: string): void {
  enterRenameMode(li, path, (oldPath: string, newValue: string) => {
    const newPath = resolvePath(oldPath, newValue);
    try {
      fs.move(oldPath, newPath);
      const tab = state.getByPath(oldPath);
      if (tab instanceof EditorTab) {
        tab.path = newPath;
        updateTabLabel(tab.id, newPath.split("/").pop() || "");
        const btn = document.getElementById(`btn-${newPath}`);
        if (btn) btn.onclick = () => switchTab(newPath);
      }

      if (state.active === oldPath) state.setActive(newPath);
    } catch (e: any) {
      alert(e.message);
    }
  });
}

function handleDelete(path: string): void {
  try {
    fs.delete(path);
    removeTabUI(path);
    const tab = state.getById(path);
    if (tab) {
      if (tab instanceof EditorTab) {
        tab.destroy();
      }
      state.delete(path);
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
