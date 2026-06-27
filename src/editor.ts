import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";

export { EditorView };

type LanguageExt = "html" | "css" | "js" | string;

const languageMap: Record<LanguageExt, any> = {
  html: html(),
  css: css(),
  js: javascript(),
};

export function createEditor(
  path: string,
  content: string,
  onUpdate: (content: string) => void,
  container: HTMLElement,
): EditorView {
  if (typeof content !== "string") throw new TypeError();

  const state = EditorState.create({
    doc: content,
    extensions: [
      basicSetup,
      languageMap[getLanguage(path)] || basicSetup,
      EditorView.updateListener.of((v) => {
        if (v.docChanged) {
          onUpdate(v.state.doc.toString());
        }
      }),
    ],
  });

  return new EditorView({
    state: state,
    parent: container,
  });
}

export function updateEditorContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

function getLanguage(path: string): LanguageExt {
  const ext = path.split(".").pop();
  return ext || ""; // 'html', 'css', 'js'
}
