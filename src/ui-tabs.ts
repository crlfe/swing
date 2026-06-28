import { h } from "./h.ts";

export function addTab(
  path: string,
  onSwitch: (fileName: string) => void,
  onClose: (fileName: string) => void,
): HTMLElement {
  const fileName = path;

  const btn = h(
    "button",
    {
      class: "tab-btn",
      id: `btn-${fileName}`,
      onclick: () => onSwitch(fileName),
    },
    [
      path.replace(/.*\//, ""),
      h(
        "button",
        {
          class: "tab-close-btn",
          onclick: (e: Event) => {
            e.stopPropagation();
            onClose(fileName);
          },
        },
        ["×"],
      ),
    ],
  );

  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.appendChild(btn);

  const container = h("div", {
    id: `editor-${fileName}`,
    class: "editor-pane",
  });
  const editorsContainer = document.getElementById("editors-container");
  if (editorsContainer) editorsContainer.appendChild(container);

  return container;
}

export function activateTab(fileName: string): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.getElementById(`btn-${fileName}`);
  if (activeBtn) activeBtn.classList.add("active");

  document.querySelectorAll(".editor-pane").forEach((pane) => pane.classList.remove("active"));
  const activePane = document.getElementById(`editor-${fileName}`);
  if (activePane) activePane.classList.add("active");
}

export function removeTabUI(fileName: string): void {
  const btn = document.getElementById(`btn-${fileName}`);
  const container = document.getElementById(`editor-${fileName}`);
  if (btn) btn.remove();
  if (container) container.remove();
}

export function updateTabLabel(oldPath: string, newPath: string, newName: string): void {
  const tabBtn = document.getElementById(`btn-${oldPath}`);
  if (tabBtn) {
    tabBtn.id = `btn-${newPath}`;
    if (tabBtn.firstChild) {
      tabBtn.firstChild.textContent = newName;
    }
  }
  const editorPane = document.getElementById(`editor-${oldPath}`);
  if (editorPane) {
    editorPane.id = `editor-${newPath}`;
  }
}
