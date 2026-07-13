import { h } from "../h.ts";

export interface TabView {
  readonly id: string;
  readonly label: string;
  readonly view: HTMLElement;

  shown(): void;
  close(): void;
}

export type ActiveListener = (
  newActive: TabView | undefined,
  oldActive: TabView | undefined,
) => void;

interface TabEntry {
  readonly button: HTMLButtonElement;
  readonly tab: TabView;
}

export class TabsView implements Iterable<TabView> {
  readonly view: HTMLElement;

  readonly #tabs: TabEntry[] = [];
  readonly #tabsContainer: HTMLElement;
  readonly #bodyContainer: HTMLElement;

  #active: TabEntry | undefined;
  readonly #activeListeners = new Set<ActiveListener>();

  constructor() {
    this.view = h("div", { class: "tabs" }, [
      (this.#tabsContainer = h("nav", {}, [])),
      (this.#bodyContainer = h("div", {}, [])),
    ]);
  }

  get active(): TabView | undefined {
    return this.#active?.tab;
  }

  addActiveListener(listener: ActiveListener): void {
    this.#activeListeners.add(listener);
  }

  removeActiveListener(listener: ActiveListener): void {
    this.#activeListeners.delete(listener);
  }

  activate(id: string): boolean {
    const entry = this.#tabs.find((entry) => entry.tab.id === id);
    this.#activateImpl(entry);
    return entry != undefined;
  }

  push(tab: TabView, activate?: boolean): void {
    const label = document.createTextNode(tab.label);
    const button = h(
      "button",
      {
        class: "tabs-button",
        onclick: () => {
          this.#activateImpl(entry);
        },
      },
      [
        label,
        h(
          "button",
          {
            class: "tabs-close",
            onclick: (e: Event) => {
              e.stopPropagation();
              tab.close();
              this.#removeImpl(entry);
            },
          },
          ["\u00d7"],
        ),
      ],
    );

    const entry: TabEntry = { button, tab };
    this.#tabs.push(entry);
    this.#tabsContainer.append(button);
    this.#bodyContainer.append(tab.view);
    tab.view.style.display = "none";
    if (activate) this.#activateImpl(entry);
  }

  [Symbol.iterator](): Iterator<TabView> {
    return this.#tabs.map((entry) => entry.tab).values();
  }

  updateLabel(id: string): void {
    const entry = this.#tabs.find((e) => e.tab.id === id);
    if (entry && entry.button.firstChild) {
      entry.button.firstChild.textContent = entry.tab.label;
    }
  }

  remove(id: string): void {
    const entry = this.#tabs.find((e) => e.tab.id === id);
    if (entry) {
      this.#removeImpl(entry);
    }
  }

  #activateImpl(entry: TabEntry | undefined) {
    const oldActive = this.#active;
    const newActive = entry;
    if (oldActive === newActive) return;

    if (this.#active) {
      this.#active.button.classList.remove("tabs-active");
      this.#active.tab.view.style.display = "none";
    }
    if (entry) {
      entry.button.classList.add("tabs-active");
      entry.tab.view.style.display = "";
      entry.tab.shown();
    }

    this.#active = entry;

    for (const listener of this.#activeListeners) {
      listener(newActive?.tab, oldActive?.tab);
    }
  }

  #removeImpl(entry: TabEntry) {
    const index = this.#tabs.indexOf(entry);
    if (index >= 0) {
      this.#tabs.splice(index, 1);
    }
    this.#tabsContainer.removeChild(entry.button);
    this.#bodyContainer.removeChild(entry.tab.view);
    if (entry === this.#active) {
      this.#activateImpl(this.#tabs[index] ?? this.#tabs[index - 1]);
    }
  }
}
