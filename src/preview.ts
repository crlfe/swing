import { type EditorView } from "./editor";
import { type Files } from "./fs";

export function refreshPreview(
  activeHtmlFile: string,
  fs: Files,
  views: Record<string, EditorView>,
): void {
  let htmlContent = "";

  try {
    htmlContent = views[activeHtmlFile]?.state.doc.toString() || fs.read(activeHtmlFile);
  } catch (e) {
    htmlContent = "<h1>No HTML file active</h1>";
  }

  const linkRegex = /<link\s+[^>]*rel=["']stylesheet["']\s+href=["']([^"']+)["'][^>]*>/g;
  let bundledHtml = htmlContent.replace(linkRegex, (match, path) => {
    try {
      const content = views[path]?.state.doc.toString() || fs.read(path);
      return `<style>\n${content}\n</style>`;
    } catch (e) {
      return match;
    }
  });

  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/g;
  bundledHtml = bundledHtml.replace(scriptRegex, (match, path) => {
    try {
      const content = views[path]?.state.doc.toString() || fs.read(path);
      return `<script>\n${content}\n</script>`;
    } catch (e) {
      return match;
    }
  });

  const iframe = document.getElementById("preview-iframe");
  if (iframe instanceof HTMLIFrameElement) iframe.srcdoc = bundledHtml;
}

let previewTimeout: number | undefined;
export function debouncedRefreshPreview(
  activeHtmlFile: string,
  fs: Files,
  views: Record<string, EditorView>,
  delay = 300,
): void {
  if (previewTimeout != null) clearTimeout(previewTimeout);
  previewTimeout = setTimeout(() => {
    refreshPreview(activeHtmlFile, fs, views);
  }, delay);
}
