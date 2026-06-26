import { createEditor } from "./editor";
import { Files } from "./fs";
import { debouncedRefreshPreview, refreshPreview } from "./preview";
import { state } from "./state";
import { renderChat } from "./ui-chat";
import { enterRenameMode, renderSidebar, resolvePath } from "./ui-sidebar";
import { activateTab, addTab, removeTabUI, updateTabLabel } from "./ui-tabs";

interface FileInfo {
  path: string;
  isDirectory: boolean;
  name: string;
}

const fs = new Files("swing_editor_files");

function updateWorkspaceVisibility(): void {
  const workspace = document.getElementById("workspace");
  if (!workspace) return;
  const hasOpenTabs = Object.keys(state.views).length > 0;
  workspace.classList.toggle("collapsed", !hasOpenTabs);
}

function switchTab(fileName: string): void {
  state.setActiveFile(fileName);
  activateTab(fileName);
  document.querySelectorAll(".file-item").forEach((item) => {
    const el = item as HTMLElement;
    el.classList.toggle("active", el.dataset.filename === fileName);
  });
  refreshPreview(state.activeHtmlFile, fs, state.views);
  const view = state.getView(fileName);
  if (view) {
    view.requestMeasure();
  }
}

function handleFileOpen(file: FileInfo, isNew = false): void {
  if (isNew) {
    try {
      fs.write(file.path, "");
    } catch (e: any) {
      alert(e.message);
      return;
    }
    initSidebar(); // Re-render sidebar to show the new file
  }

  if (!state.getView(file.path)) {
    const container = addTab(file, switchTab, (path: string) => {
      removeTabUI(path);
      const view = state.getView(path);
      if (view) {
        view.destroy();
        state.unregisterView(path);
      }
      updateWorkspaceVisibility();
      if (state.activeFile === path) {
        const tabs = document.querySelectorAll(".tab-btn");
        if (tabs.length > 0) {
          const firstTab = tabs[0] as HTMLElement;
          switchTab(firstTab.id.replace("btn-", ""));
        }
      }
    });

    const view = createEditor(
      file.path,
      fs.read(file.path),
      (content: string) => {
        fs.write(file.path, content);
        debouncedRefreshPreview(state.activeHtmlFile, fs, state.views);
      },
      container,
    );
    state.registerView(file.path, view);
  }
  switchTab(file.path);
  updateWorkspaceVisibility();
}

function handleRename(li: HTMLElement, file: FileInfo): void {
  enterRenameMode(li, file, (oldFile: FileInfo, newValue: string) => {
    const oldPath = oldFile.path;
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
      if (state.activeFile === oldPath) state.setActiveFile(newPath);
      refreshPreview(state.activeHtmlFile, fs, state.views);
    } catch (e: any) {
      alert(e.message);
    }
    initSidebar();
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
    initSidebar();
    updateWorkspaceVisibility();
  } catch (e: any) {
    alert(e.message);
  }
}

function initSidebar(): void {
  renderSidebar(fs, handleFileOpen, handleRename, handleDelete);
}

function initPreviewToggle(): void {
  const btn = document.getElementById("toggle-preview-btn");
  const container = document.getElementById("preview-container");
  if (!btn || !container) return;

  btn.onclick = () => {
    const isCollapsed = container.classList.toggle("collapsed");
    btn.innerText = isCollapsed ? "«" : "»";
    document.body.classList.toggle("preview-collapsed", isCollapsed);
  };
}

initSidebar();
initPreviewToggle();
renderChat(fs);
const initialFiles = fs.list().filter((f: FileInfo) => !f.isDirectory);
if (initialFiles.length > 0) {
  handleFileOpen(initialFiles[0]);
} else {
  updateWorkspaceVisibility();
}
refreshPreview(state.activeHtmlFile, fs, state.views);
