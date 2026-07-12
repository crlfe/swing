import { h } from "./h.ts";

export function addTab(
  id: string,
  label: string,
  onSwitch: (id: string) => void,
  onClose: (id: string) => void,
): HTMLElement {
  const btn = h(
    "button",
    {
      class: "tab-btn",
      id: `btn-${id}`,
      onclick: () => onSwitch(id),
    },
    [
      label,
      h(
        "button",
        {
          class: "tab-close-btn",
          onclick: (e: Event) => {
            e.stopPropagation();
            onClose(id);
          },
        },
        ["\u00d7"],
      ),
    ],
  );

  const tabBar = document.getElementById("tab-bar");
  if (tabBar) tabBar.appendChild(btn);

  const container = h("div", {
    id: `editor-${id}`,
    class: "editor-pane",
  });
  const editorsContainer = document.getElementById("editors-container");
  if (editorsContainer) editorsContainer.appendChild(container);

  return container;
}

export function activateTab(id: string): void {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
  const activeBtn = document.getElementById(`btn-${id}`);
  if (activeBtn) activeBtn.classList.add("active");

  document.querySelectorAll(".editor-pane").forEach((pane) => pane.classList.remove("active"));
  const activePane = document.getElementById(`editor-${id}`);
  if (activePane) activePane.classList.add("active");
}

export function removeTabUI(id: string): void {
  const btn = document.getElementById(`btn-${id}`);
  const container = document.getElementById(`editor-${id}`);
  if (btn) btn.remove();
  if (container) container.remove();
}

export function updateTabLabel(id: string, newName: string): void {
  const tabBtn = document.getElementById(`btn-${id}`);
  if (tabBtn && tabBtn.firstChild) {
    tabBtn.firstChild.textContent = newName;
  }
}
