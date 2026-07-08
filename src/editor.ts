import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export type { EditorView };

// The basicSetup is very large and always required, so start loading it now.
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

export async function createEditor(
  path: string,
  content: string,
  onUpdate: (content: string) => void,
  container: HTMLElement,
): Promise<EditorView> {
  if (typeof content !== "string") throw new TypeError();

  const extensions: Extension[] = [await basicSetupPromise];

  const langKey = extensionMap[path.replace(/.*\./, "")];
  if (langKey) {
    extensions.push(await languageModes[langKey]());
  }

  extensions.push(
    EditorView.updateListener.of((v) => {
      if (v.docChanged) {
        onUpdate(v.state.doc.toString());
      }
    }),
  );

  return new EditorView({
    state: EditorState.create({
      doc: content,
      extensions,
    }),
    parent: container,
  });
}

export function updateEditorContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}
