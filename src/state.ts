export interface AppTab {
  readonly id: string;
  readonly path: string | undefined;
}

export class AppState {
  readonly #tabs = new Map<string, AppTab>();
  #active: string | null = null;
  #nextTabId: number = 0;

  get active(): string | null {
    return this.#active;
  }

  nextTabId(): string {
    return `t${this.#nextTabId++}`;
  }

  setActive(id: string): void {
    this.#active = id;
  }

  getById(id: string): AppTab | undefined {
    return this.#tabs.get(id);
  }

  getByPath(path: string): AppTab | undefined {
    return this.#tabs.values().find((tab) => tab.path && tab.path === path);
  }

  add(tab: AppTab): void {
    if (this.#tabs.has(tab.id)) {
      throw new Error("Tab already registered with this id");
    }
    this.#tabs.set(tab.id, tab);
  }

  delete(id: string): void {
    this.#tabs.delete(id);
  }
}
