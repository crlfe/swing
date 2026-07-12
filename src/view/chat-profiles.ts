import { type ChatProfile, type ChatProfiles, ChatProfilesManager } from "../chat/profiles.ts";
import { h } from "../h.ts";

export const DEFAULT_SYSTEM_PROMPT = "Be a concise and professional coding assistant.";

export class ChatProfilesView {
  private readonly manager = new ChatProfilesManager();
  public readonly dialogView: HTMLDialogElement;
  public readonly selectView: HTMLElement;
  private readonly selectElement: HTMLSelectElement;
  private readonly tableBody: HTMLElement;
  private workingProfiles: ChatProfiles = {};

  private _onchange: (() => void | Promise<void>) | null = null;

  public get value(): ChatProfile | undefined {
    return this.manager.getActiveProfile();
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
                  { style: { width: "20%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  ["Model"],
                ),
                h(
                  "th",
                  { style: { width: "20%", "border-bottom": "1px solid #ccc", padding: "8px" } },
                  ["API Key"],
                ),
                h(
                  "th",
                  { style: { width: "10%", "border-bottom": "1px solid #ccc", padding: "8px" } },
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
        onchange: () => {
          this.manager.setActiveProfileName(this.selectElement.value);
          this._onchange?.();
        },
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
    const profiles = this.manager.profiles;
    this.selectElement.style.display = Object.keys(profiles).length === 0 ? "none" : "";
  }

  private updateSelectOptions(select: HTMLSelectElement) {
    select.innerHTML = "";
    select.appendChild(h("option", { value: "disabled" }, ["Disabled"]));

    const profiles = this.manager.profiles;
    const profileEntries = Object.entries(profiles);
    profileEntries.forEach(([name]) => {
      select.appendChild(h("option", { value: name }, [name]));
    });

    const activeProfileName = this.manager.getActiveProfileName();
    if (activeProfileName === "disabled" || profiles[activeProfileName]) {
      select.value = activeProfileName;
    } else {
      select.value = "disabled";
      this.manager.setActiveProfileName("");
    }
  }

  private moveProfile(index: number, direction: number) {
    const entries = Object.entries(this.workingProfiles);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= entries.length) return;

    entries.splice(newIndex, 0, ...entries.splice(index, 1));

    this.workingProfiles = Object.fromEntries(entries);
    this.renderTable();
  }

  public refreshSelect(): void {
    const select = this.selectView.querySelector("select") as HTMLSelectElement;
    if (select) {
      this.updateSelectOptions(select);
    }
    this.updateSelectVisibility();
  }

  private async editProfiles(): Promise<void> {
    const profiles = this.manager.profiles;
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
        this.manager.profiles = this.workingProfiles;

        const activeProfileName = this.manager.getActiveProfileName();
        if (activeProfileName && !this.workingProfiles[activeProfileName]) {
          this.manager.setActiveProfileName("");
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
    let suffix = 1;
    while (this.workingProfiles[`Profile ${suffix}`]) {
      suffix++;
    }
    const name = `Profile ${suffix}`;
    this.workingProfiles[name] = {
      url: "http://localhost:11434/v1/chat/completions",
      model: "gemma4:31b-cloud",
      key: "",
      systemPrompt: "",
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
                this.workingProfiles[name] = { ...profile, url: e.target.value };
              },
            }),
          ],
        ),
        h("td", { style: { padding: "8px", "border-bottom": "1px solid #eee" } }, [
          h("input", {
            value: profile.model,
            style: { width: "100%", border: "none", background: "transparent", padding: "0" },
            onchange: (e: any) => {
              this.workingProfiles[name] = { ...profile, model: e.target.value };
            },
          }),
        ]),
        h("td", { style: { padding: "8px", "border-bottom": "1px solid #eee" } }, [
          h("input", {
            type: "password",
            value: profile.key,
            style: { width: "100%", border: "none", background: "transparent", padding: "0" },
            onchange: (e: any) => {
              this.workingProfiles[name] = { ...profile, key: e.target.value };
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
                onclick: () => this.moveProfile(index, -1),
              },
              ["↑"],
            ),
            h(
              "button",
              {
                onclick: () => this.moveProfile(index, 1),
              },
              ["↓"],
            ),
            h(
              "button",
              {
                onclick: () => {
                  let copyName = `${name} (Copy)`;
                  let suffix = 2;
                  while (this.workingProfiles[copyName]) {
                    copyName = `${name} (Copy ${suffix++})`;
                  }
                  this.workingProfiles[copyName] = { ...profile };
                  this.renderTable();
                },
              },
              ["Copy"],
            ),
            h(
              "button",
              {
                onclick: () => this.editSystemPrompt(name, profile),
              },
              ["Prompt"],
            ),
            h(
              "button",
              {
                onclick: () => {
                  if (confirm(`Are you sure you want to delete profile "${name}"?`)) {
                    delete this.workingProfiles[name];
                    this.renderTable();
                  }
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

  private editSystemPrompt(name: string, profile: ChatProfile) {
    const newPrompt = prompt("Edit system prompt:", profile.systemPrompt || DEFAULT_SYSTEM_PROMPT);
    if (newPrompt !== null) {
      this.workingProfiles[name] = { ...profile, systemPrompt: newPrompt };
    }
  }
}
