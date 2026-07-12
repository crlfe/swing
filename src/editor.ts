import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { FileTree } from "./data/file-tree.ts";

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

export class EditorTab {
  public readonly view: Promise<EditorView>;
  private unwatch?: () => void;

  constructor(
    public readonly id: string,
    public path: string | undefined,
    public label: string,
    initialContent: string,
    container: HTMLElement,
    private fs: FileTree,
  ) {
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

    this.view = Promise.all(extensions).then(
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
      this.unwatch = fs.watch(path, () => {
        if (!fs.has(path)) {
          this.unwatch!();
          return;
        }
        this.updateContent(fs.read(path).join("\n"));
      });
    }
  }

  public async updateContent(content: string): Promise<void> {
    const view = await this.view;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }

  public async destroy(): Promise<void> {
    this.unwatch?.();
    (await this.view).destroy();
  }
}
