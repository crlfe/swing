import { type EditorView, updateEditorContent } from "./editor.ts";

interface AppState {
  views: Record<string, EditorView>;
  activeId: string | null;

  setActiveTab(id: string): void;
  registerView(id: string, view: EditorView): void;
  unregisterView(id: string): void;
  getView(id: string): EditorView | undefined;
  updateViewContent(id: string, content: string): void;
}

export const state: AppState = {
  views: {},
  activeId: null,

  setActiveTab(id) {
    this.activeId = id;
  },

  registerView(id, view) {
    this.views[id] = view;
  },

  unregisterView(id) {
    delete this.views[id];
  },

  getView(id) {
    return this.views[id];
  },

  updateViewContent(id, content) {
    const view = this.getView(id);
    if (view) {
      updateEditorContent(view, content);
    }
  },
};
