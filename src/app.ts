import { FileTree } from "./data/file-tree.ts";
import { EditorTab } from "./editor.ts";
import { getExampleFiles } from "./fs-example.ts";
import { h } from "./h.ts";
import { enterRenameMode, SidebarView } from "./ui-sidebar.ts";
import { resolvePath } from "./util.ts";
import { ChatView } from "./view/chat.ts";
import { TabsView } from "./view/tabs.ts";

const STORAGE_KEY = "swing_editor_files";
const STORAGE_VERSION = 1;

export function app() {
  const tabsView = new TabsView();
  const fs = new FileTree();

  let nextTabId = 0;

  const getTabByPath = (path: string) => {
    for (const tab of tabsView) {
      if (tab instanceof EditorTab && tab.path === path) {
        return tab;
      }
    }
    return undefined;
  };

  // --- Persistence ---
  const loadInitialFiles = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const { version, files } = JSON.parse(saved);
        if (version === STORAGE_VERSION) return files;
        console.error("Ignoring incompatible saved project");
      }
    } catch (e) {
      console.error("Failed to load files from localStorage", e);
    }
    return getExampleFiles();
  };

  fs.fromJSON(loadInitialFiles());

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

  tabsView.addActiveListener((newActive) => {
    const newPath = newActive instanceof EditorTab ? newActive.path : undefined;
    document.querySelectorAll(".file-item").forEach((elem) => {
      if (elem instanceof HTMLElement) {
        elem.classList.toggle("active", Boolean(newPath) && elem.dataset.filename === newPath);
      }
    });
  });

  // --- Event Handlers ---
  async function handleFileOpen(options: {
    label: string;
    content?: string[];
    path?: string;
  }): Promise<void> {
    const { label, content: initialContent, path } = options;

    let tab = path ? getTabByPath(path) : undefined;
    if (!tab) {
      const id = `t${nextTabId++}`;
      const container = h("div", { class: "editor-pane" });
      const fileContent = (path ? fs.read(path) : (initialContent ?? [])).join("\n");

      tab = new EditorTab(id, path, label, fileContent, container, fs);
      tabsView.push(tab);
    }
    tabsView.activate(tab.id);
  }

  function handleRename(li: HTMLElement, path: string): void {
    enterRenameMode(li, path).then((newValue) => {
      const newPath = resolvePath(path, newValue);
      try {
        fs.move(path, newPath);
        const tab = getTabByPath(path);
        if (tab instanceof EditorTab) {
          tab.path = newPath;
          tab.label = newPath.split("/").pop() || "";
          tabsView.updateLabel(tab.id);
        }
        document.querySelectorAll(".file-item").forEach((elem) => {
          if (elem instanceof HTMLElement) {
            elem.classList.toggle("active", Boolean(newPath) && elem.dataset.filename === newPath);
          }
        });
      } catch (e: any) {
        alert(e.message);
      }
    });
  }

  function handleDelete(path: string): void {
    try {
      fs.delete(path);
      const tab = getTabByPath(path);
      if (tab) {
        if (tab instanceof EditorTab) tab.close();
        tabsView.remove(tab.id);
      }
    } catch (e: any) {
      alert(e.message);
    }
  }

  const sidebar = new SidebarView(fs, handleFileOpen, handleRename, handleDelete);
  const view = [
    sidebar.view,
    h("div", { id: "main-content" }, [tabsView.view, new ChatView(fs).view]),
  ];

  return view;
}
