import { diffTree, formatPatch } from "./data/diff.ts";
import type { FileTree } from "./data/file-tree.ts";
import { nodeFromObject, type RecursiveRecord } from "./data/trees.ts";
import { h } from "./h.ts";

async function getAuthToken(): Promise<string | null> {
  let token = localStorage.getItem("auth_token");
  if (!token) {
    token = prompt("Please enter your authorization token:");
    if (token) localStorage.setItem("auth_token", token);
  }
  return token;
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("auth_token");
  }

  return response;
}

export function renderDevModeButtons(
  fs: FileTree,
  onOpen: (
    id: string,
    options: { label: string; content?: string[]; path?: string },
  ) => Promise<void>,
): HTMLElement[] {
  if (import.meta.env.MODE === "production") return [];

  return [
    h(
      "button",
      {
        onclick: async () => {
          try {
            const res = await authenticatedFetch("/api/fs");
            if (!res.ok) throw new Error(`Server responded with ${res.status}`);
            const data = await res.json();
            fs.fromJSON(data);
          } catch (e: any) {
            alert(`Failed to load project: ${e.message}`);
          }
        },
      },
      ["Dev: Load Source"],
    ),
    h(
      "button",
      {
        onclick: async () => {
          try {
            const res = await authenticatedFetch("/api/fs");
            if (!res.ok) throw new Error(`Server responded with ${res.status}`);
            const diskTree = nodeFromObject((await res.json()) as RecursiveRecord<string, string>);
            const patch = diffTree(diskTree, fs.getRoot());
            await onOpen(":diff-source", {
              label: "Diff Source",
              content: formatPatch(patch).split("\n"),
            });
          } catch (e: any) {
            alert(`Failed to diff project: ${e.message}`);
          }
        },
      },
      ["Dev: Diff Source"],
    ),
    h(
      "button",
      {
        onclick: async () => {
          try {
            const data = fs.toJSON();
            const res = await authenticatedFetch("/api/fs", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            });
            if (!res.ok) throw new Error(`Server responded with ${res.status}`);
            alert("Project saved to disk!");
          } catch (e: any) {
            alert(`Failed to save project: ${e.message}`);
          }
        },
      },
      ["Dev: Save Source"],
    ),
    h("div", { style: "height: 0.5em" }),
  ];
}
