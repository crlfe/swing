import { createEditor } from "./editor.ts";
import { Files } from "./fs.ts";
import { state } from "./state.ts";
import { renderChat } from "./ui-chat.ts";
import { enterRenameMode, renderSidebar, resolvePath } from "./ui-sidebar.ts";
import { activateTab, addTab, removeTabUI, updateTabLabel } from "./ui-tabs.ts";

const fs = new Files("swing_editor_files");

console.log("Testing!");

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
  // refreshPreview(state.activeHtmlFile, fs, state.views);
  const view = state.getView(fileName);
  if (view) {
    view.requestMeasure();
  }
}

function handleFileOpen(path: string, isNew = false): void {
  if (isNew) {
    try {
      fs.write(path, "");
    } catch (e: any) {
      alert(e.message);
      return;
    }
    initSidebar(); // Re-render sidebar to show the new file
  }

  if (!state.getView(path)) {
    const container = addTab(path, switchTab, (path: string) => {
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
      path,
      fs.read(path),
      (content: string) => {
        fs.write(path, content);
        // debouncedRefreshPreview(state.activeHtmlFile, fs, state.views);
      },
      container,
    );
    state.registerView(path, view);
  }
  switchTab(path);
  updateWorkspaceVisibility();
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
      if (state.activeFile === oldPath) state.setActiveFile(newPath);
      // refreshPreview(state.activeHtmlFile, fs, state.views);
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

  // btn.onclick = () => {
  //   const isCollapsed = container.classList.toggle("collapsed");
  //   btn.innerText = isCollapsed ? "«" : "»";
  //   document.body.classList.toggle("preview-collapsed", isCollapsed);
  // };

  // Force collapsed state for now
  container.classList.add("collapsed");
  btn.innerText = "«";
  document.body.classList.add("preview-collapsed");
}

initSidebar();
initPreviewToggle();
renderChat(fs);
const initialFiles = fs.list().filter((path) => !path.endsWith("/"));
if (initialFiles.length > 0) {
  handleFileOpen(initialFiles[0]);
} else {
  updateWorkspaceVisibility();
}
// refreshPreview(state.activeHtmlFile, fs, state.views);

if (import.meta.hot) {
  // This code will be deleted by the build process.
  async function initializeLocalEdit() {
    const params = new URLSearchParams(window.location.search);
    const localEdit = params.get("local-edit");
    if (!localEdit) return;

    try {
      const response = await fetch("/@swing/src", {
        headers: {
          Authorization: `Bearer ${localEdit}`,
        },
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      fs.fromJSON(await response.json());

      initSidebar();

      const btn = document.getElementById("toggle-preview-btn");
      const container = document.getElementById("preview-container");
      if (btn && container) {
        container.classList.add("collapsed");
        btn.innerText = "«";
        document.body.classList.add("preview-collapsed");
      }
    } catch (e) {
      console.error("Failed to fetch files from local-edit", e);
    }
  }
  initializeLocalEdit();
}
