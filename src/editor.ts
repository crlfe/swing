import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { FileTree } from "./data/file-tree.ts";
import type { TabView } from "./view/tabs.ts";

export type { EditorView };

const basicSetupPromise = import("codemirror").then((m) => m.basicSetup);

const languageModes = {
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  javascript: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  yaml: () => import("@codemirror/lang-yaml").then((m) => m.yaml()),
} as const;

const extensionMap: Record<string, keyof typeof languageModes> = {
  css: "css",
  html: "html",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  markdown: "markdown",
  md: "markdown",
  ts: "javascript",
  tsx: "javascript",
  yaml: "yaml",
  yml: "yaml",
};

export class EditorTab implements TabView {
  #container: HTMLElement;
  #unwatch?: () => void;

  public readonly viewPromise: Promise<EditorView>;

  constructor(
    public readonly id: string,
    public path: string | undefined,
    public label: string,
    initialContent: string,
    container: HTMLElement,
    private fs: FileTree,
  ) {
    this.#container = container;

    const extensions: (Extension | Promise<Extension>)[] = [basicSetupPromise];

    if (path) {
      const langKey = extensionMap[path.replace(/.*\./, "")];
      if (langKey) {
        extensions.push(languageModes[langKey]());
      }
    }

    extensions.push(
      EditorView.updateListener.of((v) => {
        if (v.docChanged && path) {
          fs.write(path, v.state.doc.toString().split("\n"));
        }
      }),
    );

    this.viewPromise = Promise.all(extensions).then(
      (extensions) =>
        new EditorView({
          state: EditorState.create({
            doc: initialContent,
            extensions,
          }),
          parent: container,
        }),
    );

    if (path) {
      this.#unwatch = fs.watch(path, () => {
        if (!fs.has(path)) {
          this.#unwatch!();
          return;
        }

        const content = fs.read(path).join("\n");
        this.viewPromise.then((view) => {
          if (view.state.doc.toString() !== content) {
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: content },
            });
          }
        });
      });
    }
  }

  get view() {
    return this.#container;
  }

  shown() {
    this.viewPromise.then((v) => v.requestMeasure());
  }

  close() {
    this.#unwatch?.();
    this.viewPromise.then((view) => view.destroy());
  }
}
