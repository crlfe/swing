import { type EditorView, updateEditorContent } from "./editor";

interface AppState {
  views: Record<string, EditorView>;
  activeHtmlFile: string;
  activeFile: string | null;

  setActiveFile(path: string): void;
  registerView(path: string, view: EditorView): void;
  unregisterView(path: string): void;
  getView(path: string): EditorView | undefined;
  updateViewContent(path: string, content: string): void;
}

export const state: AppState = {
  views: {},
  activeHtmlFile: "index.html",
  activeFile: null,

  setActiveFile(path) {
    this.activeFile = path;
    if (path.endsWith(".html")) {
      this.activeHtmlFile = path;
    }
  },

  registerView(path, view) {
    this.views[path] = view;
  },

  unregisterView(path) {
    delete this.views[path];
  },

  getView(path) {
    return this.views[path];
  },

  updateViewContent(path, content) {
    const view = this.getView(path);
    if (view) {
      updateEditorContent(view, content);
    }
  },
};
