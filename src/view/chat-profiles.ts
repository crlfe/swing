import { h } from "../h.ts";

export interface ChatProfile {
  url: string;
  model: string;
  key: string;
}

export type ChatProfiles = Record<string, ChatProfile>;

export class ChatProfilesManager {
  public readonly dialogView: HTMLDialogElement;
  public readonly selectView: HTMLElement;
  private readonly selectElement: HTMLSelectElement;
  private readonly tableBody: HTMLElement;
  private workingProfiles: ChatProfiles = {};

  private _onchange: (() => void | Promise<void>) | null = null;

  public get value(): string {
    return this.selectElement.value;
  }

  public set onchange(handler: () => void | Promise<void>) {
    this._onchange = handler;
  }

  constructor() {
    const tableBody = h("tbody", { id: "chat-profiles-table-body" }, []);

    this.dialogView = h("dialog", { class: "chat-profiles-dialog" }, [
      h("div", { class: "chat-profiles-content", style: { minWidth: "800px", padding: "20px" } }, [
        h("h3", {}, ["Chat Profiles"]),
        h(
          "table",
          {
            style: {
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              marginBottom: "20px",
            },
          },
          [
            h("thead", {}, [
              h("tr", { style: { textAlign: "left" } }, [
                h(
                  "th",
                  { style: { width: "15%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  ["Name"],
                ),
                h(
                  "th",
                  { style: { width: "45%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  ["URL"],
                ),
                h(
                  "th",
                  { style: { width: "25%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  ["Model"],
                ),
                h(
                  "th",
                  { style: { width: "15%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  [""],
                ),
              ]),
            ]),
            tableBody,
          ],
        ),
        h(
          "div",
          {
            class: "chat-profiles-actions",
            style: { display: "flex", justifyContent: "space-between", gap: "10px" },
          },
          [
            h(
              "button",
              {
                onclick: () => this.addNewProfile(),
              },
              ["+ Add Profile"],
            ),
            h("div", { style: { display: "flex", gap: "10px" } }, [
              h("button", { id: "chat-profiles-cancel" }, ["Cancel"]),
              h("button", { id: "chat-profiles-ok" }, ["OK"]),
            ]),
          ],
        ),
      ]),
    ]) as unknown as HTMLDialogElement;

    this.selectElement = h(
      "select",
      {
        id: "chat-profile-select",
        style: { fontSize: "10px", cursor: "pointer" },
        onchange: () => this._onchange?.(),
      },
      [],
    ) as unknown as HTMLSelectElement;

    this.selectView = h("div", { style: { display: "flex", alignItems: "center", gap: "4px" } }, [
      this.selectElement,
      h(
        "button",
        {
          style: { fontSize: "10px", padding: "0 4px" },
          onclick: () => this.editProfiles(),
        },
        ["⚙️"],
      ),
    ]);
    this.tableBody = tableBody;

    this.updateSelectOptions(this.selectElement);
    this.updateSelectVisibility();
  }

  private updateSelectVisibility() {
    const profiles = this.getProfiles();
    this.selectElement.style.display = Object.keys(profiles).length === 0 ? "none" : "";
  }

  private updateSelectOptions(select: HTMLSelectElement) {
    select.innerHTML = "";
    select.appendChild(h("option", { value: "disabled" }, ["Disabled"]));

    const profiles = this.getProfiles();
    const profileEntries = Object.entries(profiles);
    profileEntries.forEach(([name]) => {
      select.appendChild(h("option", { value: name }, [name]));
    });

    const currentProfileName = this.getCurrentProfileName();
    if (currentProfileName === "disabled" || profiles[currentProfileName]) {
      select.value = currentProfileName;
    } else {
      select.value = "disabled";
      localStorage.setItem("chat-current-profile", "disabled");
    }
  }

  public getProfiles(): ChatProfiles {
    return JSON.parse(localStorage.getItem("chat-profiles") || "{}");
  }

  public getCurrentProfileName(): string {
    return localStorage.getItem("chat-current-profile") || "disabled";
  }

  public applyProfile(name: string): void {
    const profiles = this.getProfiles();
    const profile = profiles[name];
    if (profile) {
      localStorage.setItem("chat-url", profile.url);
      localStorage.setItem("chat-model", profile.model);
      localStorage.setItem("chat-key", profile.key);
    }
    localStorage.setItem("chat-current-profile", name);
  }

  public refreshSelect(): void {
    const select = this.selectView.querySelector("select") as HTMLSelectElement;
    if (select) {
      this.updateSelectOptions(select);
    }
    this.updateSelectVisibility();
  }

  private async editProfiles(): Promise<void> {
    const profiles = this.getProfiles();
    this.workingProfiles = { ...profiles };
    this.renderTable();
    this.dialogView.showModal();

    await new Promise<void>((resolve) => {
      const okBtn = this.dialogView.querySelector("#chat-profiles-ok") as HTMLElement;
      const cancelBtn = this.dialogView.querySelector("#chat-profiles-cancel") as HTMLElement;

      const handleCancel = () => {
        this.dialogView.close();
        cleanup();
        resolve();
      };

      const handleOk = () => {
        localStorage.setItem("chat-profiles", JSON.stringify(this.workingProfiles));

        const currentProfileName = this.getCurrentProfileName();
        if (currentProfileName !== "disabled" && !this.workingProfiles[currentProfileName]) {
          localStorage.setItem("chat-current-profile", "disabled");
          this.selectElement.value = "disabled";
          this._onchange?.();
        }

        this.refreshSelect();
        this.dialogView.close();
        cleanup();
        resolve();
      };

      const cleanup = () => {
        if (okBtn) okBtn.onclick = null;
        if (cancelBtn) cancelBtn.onclick = null;
      };

      if (okBtn) okBtn.onclick = handleOk;
      if (cancelBtn) cancelBtn.onclick = handleCancel;

      this.dialogView.onclose = () => {
        cleanup();
        resolve();
      };
    });
  }

  private addNewProfile() {
    const id = `new-profile-${Date.now()}`;
    this.workingProfiles[id] = {
      url: "http://localhost:11434/v1/chat/completions",
      model: "gemma4:31b-cloud",
      key: "unspecified",
    };
    this.renderTable();
  }

  private renderTable() {
    this.tableBody.innerHTML = "";

    const entries = Object.entries(this.workingProfiles);
    entries.forEach(([name, profile], index) => {
      const tr = h("tr", {}, [
        h("td", { style: { padding: "8px", "border-bottom": "1px solid #eee" } }, [
          h("input", {
            value: name,
            style: { width: "100%", border: "none", background: "transparent", padding: "0" },
            onchange: (e: any) => {
              const newName = e.target.value;
              if (!newName) return;
              if (newName !== name) {
                const { [name]: _, ...rest } = this.workingProfiles;
                this.workingProfiles = { ...rest, [newName]: profile };
                this.renderTable();
              }
            },
          }),
        ]),
        h(
          "td",
          { style: { padding: "8px", "border-bottom": "1px solid #eee", fontSize: "10px" } },
          [
            h("input", {
              value: profile.url,
              style: { width: "100%", border: "none", background: "transparent", padding: "0" },
              onchange: (e: any) => {
                profile.url = e.target.value;
              },
            }),
          ],
        ),
        h("td", { style: { padding: "8px", "border-bottom": "1px solid #eee" } }, [
          h("input", {
            value: profile.model,
            style: { width: "100%", border: "none", background: "transparent", padding: "0" },
            onchange: (e: any) => {
              profile.model = e.target.value;
            },
          }),
        ]),
        h(
          "td",
          {
            style: {
              padding: "8px",
              "border-bottom": "1px solid #eee",
              textAlign: "right",
              display: "flex",
              justifyContent: "flex-end",
              gap: "5px",
            },
          },
          [
            h(
              "button",
              {
                onclick: () => {
                  const prev = entries[index - 1];
                  if (prev != null) {
                    const newProfiles = { ...this.workingProfiles };
                    const keys = Object.keys(newProfiles);
                    const [key1, key2] = [prev[0], name];

                    const remaining = Object.entries(this.workingProfiles).filter(
                      ([k]) => k !== key1 && k !== key2,
                    );
                    const sorted = [
                      ...remaining.slice(0, index - 1),
                      [key2, newProfiles[key2]],
                      [key1, newProfiles[key1]],
                      ...remaining.slice(index - 1),
                    ];

                    this.workingProfiles = Object.fromEntries(sorted);
                    this.renderTable();
                  }
                },
              },
              ["↑"],
            ),
            h(
              "button",
              {
                onclick: () => {
                  const next = entries[index + 1];
                  if (next != null) {
                    const newProfiles = { ...this.workingProfiles };
                    const [key1, key2] = [name, next[0]];

                    const remaining = Object.entries(this.workingProfiles).filter(
                      ([k]) => k !== key1 && k !== key2,
                    );
                    const sorted = [
                      ...remaining.slice(0, index),
                      [key2, newProfiles[key2]],
                      [key1, newProfiles[key1]],
                      ...remaining.slice(index),
                    ];

                    this.workingProfiles = Object.fromEntries(sorted);
                    this.renderTable();
                  }
                },
              },
              ["↓"],
            ),
            h(
              "button",
              {
                onclick: () => {
                  delete this.workingProfiles[name];
                  this.renderTable();
                },
              },
              ["Delete"],
            ),
          ],
        ),
      ]);
      this.tableBody.appendChild(tr);
    });
  }
}
