import { getSystemPrompt, sendMessageStream, type ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import type { FileTree } from "../data/file-tree.ts";
import { h } from "../h.ts";
import { ChatProfilesManager } from "./chat-profiles.ts";

export class ChatView {
  public readonly view: HTMLElement;
  private readonly profiles = new ChatProfilesManager();

  constructor(private fs: FileTree) {
    const main = h("div", { class: "chat-main" }, [
      h("div", { class: "chat-content", id: "chat-messages" }, [
        h("div", {}, ["Welcome! How can I help you today?"]),
      ]),
      h("div", { class: "chat-input-area" }, [
        h("textarea", { id: "chat-input", placeholder: "Ask something..." }),
        h("button", { id: "chat-send-btn" }, ["Send"]),
        h("button", { id: "chat-abort-btn", disabled: true }, ["Stop"]),
        h("button", { id: "chat-clear-btn" }, ["Clear"]),
      ]),
    ]);

    this.view = h(
      "div",
      {
        id: "chat-panel",
        class: "chat-panel-content",
        style: { position: "relative" },
      },
      [
        h("div", { class: "chat-resize-handle" }),
        h(
          "div",
          {
            class: "chat-header",
            style: { display: "flex", "justify-content": "space-between", "align-items": "center" },
          },
          [h("span", {}, ["CHAT"]), this.profiles.selectView],
        ),
        main,
        this.profiles.dialogView,
      ],
    );

    const profileSelect = this.profiles.selectView;
    const sendBtn = this.view.querySelector("#chat-send-btn") as HTMLButtonElement | null;
    const abortBtn = this.view.querySelector("#chat-abort-btn") as HTMLButtonElement | null;
    const clearBtn = this.view.querySelector("#chat-clear-btn") as HTMLButtonElement | null;
    const resizeHandle = this.view.querySelector(".chat-resize-handle") as HTMLElement;
    if (resizeHandle) {
      let isResizing = false;

      resizeHandle.onmousedown = (e) => {
        isResizing = true;
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "ns-resize";
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing) return;
        const panel = this.view;
        const newHeight = window.innerHeight - e.clientY;
        panel.style.height = `${Math.max(140, newHeight)}px`;
      };

      const handleMouseUp = () => {
        isResizing = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
      };
    }

    const input = this.view.querySelector("#chat-input") as HTMLTextAreaElement | null;

    const updateInputsDisabled = (disabled: boolean, wasDisabled: boolean = false) => {
      if (input) input.disabled = disabled;
      if (sendBtn) sendBtn.disabled = disabled;
      // Abort button is managed separately during active requests

      const main = this.view.querySelector(".chat-main") as HTMLElement;
      if (main) {
        main.style.display = disabled ? "none" : "flex";
      }

      const resizeHandle = this.view.querySelector(".chat-resize-handle") as HTMLElement;
      if (resizeHandle) {
        resizeHandle.style.display = disabled ? "none" : "block";
      }

      if (disabled) {
        this.view.style.height = "";
      } else if (wasDisabled && !this.view.style.height) {
        this.view.style.height = `${window.innerHeight / 4}px`;
      }
    };

    const currentProfile = this.profiles.getCurrentProfileName();
    updateInputsDisabled(currentProfile === "disabled");
    if (currentProfile !== "disabled") {
      this.view.style.height = `${window.innerHeight / 4}px`;
    }

    this.profiles.onchange = async () => {
      const val = this.profiles.value;
      const wasDisabled = this.profiles.getCurrentProfileName() === "disabled";

      this.profiles.applyProfile(val);
      updateInputsDisabled(val === "disabled", wasDisabled);
    };

    const context = new ChatContext();
    context.addMessage({ role: "system", content: getSystemPrompt() });

    if (clearBtn) {
      clearBtn.onclick = () => {
        context.clear();
        context.addMessage({ role: "system", content: getSystemPrompt() });
        const messagesContainer = this.view.querySelector("#chat-messages");
        if (messagesContainer) {
          messagesContainer.innerHTML = "";
          messagesContainer.appendChild(h("div", {}, ["Chat history cleared."]));
        }
      };
    }

    if (sendBtn && input && abortBtn) {
      sendBtn.onclick = async () => {
        const text = input.value.trim();
        if (!text) return;

        let logElements: HTMLElement[] = [];
        let lastLog: HTMLElement | undefined;
        let lastLogType: "info" | "text" | "think" | "user" | "error" | null = null;

        const aiMsgDiv = h(
          "div",
          {
            style: { marginBottom: "10px", whiteSpace: "pre-wrap" },
          },
          [],
        );

        const messagesContainer = this.view.querySelector("#chat-messages");
        if (messagesContainer) {
          if (
            messagesContainer.children.length === 1 &&
            (messagesContainer.firstChild?.textContent === "Welcome! How can I help you today?" ||
              messagesContainer.firstChild?.textContent === "Chat history cleared.")
          ) {
            messagesContainer.innerHTML = "";
          }
          messagesContainer.appendChild(aiMsgDiv);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        const log = (msg: string, type: "info" | "text" | "think" | "user" | "error") => {
          if (lastLog && lastLogType === type) {
            lastLog.textContent += msg;
          } else {
            const prefix = type === "user" ? "User: " : "";
            lastLog = h(
              "div",
              {
                class: `log-type-${type}`,
                style: type === "error" ? { color: "red" } : {},
              },
              [prefix + msg],
            );
            logElements.push(lastLog);
          }
          lastLogType = type;

          updateMessageContent(aiMsgDiv, logElements);
          const messagesContainer = this.view.querySelector("#chat-messages");
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        };

        const controller = new AbortController();
        const config: ChatConfig = {
          url: localStorage.getItem("chat-url") || "http://localhost:11434/v1/chat/completions",
          model: localStorage.getItem("chat-model") || "gemma4:31b-cloud",
          key: localStorage.getItem("chat-key") || "unspecified",
          stream: true,
          think: true,
          fs: this.fs,
          context,
          abortController: controller,
          logInfo(msg: string) {
            log(msg, "info");
          },
          logText(msg: string) {
            log(msg, "text");
          },
          logThink(msg: string) {
            log(msg, "think");
          },
        };

        log(text, "user");
        input.value = "";
        config.context.addMessage({ role: "user", content: text });

        sendBtn.disabled = true;
        abortBtn.disabled = false;

        abortBtn.onclick = () => {
          controller.abort();
        };

        try {
          await sendMessageStream(config);
        } catch (e: any) {
          if (e.name === "AbortError") {
            if (logElements.length === 0) {
              updateMessageContent(aiMsgDiv, `Request aborted by user.`, false);
            } else {
              log(" Request aborted by user.", "info");
            }
          } else {
            log(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
          }
        } finally {
          const isDisabled = this.profiles.value === "disabled";
          sendBtn.disabled = isDisabled;
          abortBtn.disabled = true;
          abortBtn.onclick = null;
        }
      };

      input.onkeydown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };
    }
  }
}

function updateMessageContent(
  msgDiv: HTMLElement,
  content: string | HTMLElement[],
  isError = false,
): void {
  const contentEl = document.createElement("span");
  if (Array.isArray(content)) {
    content.forEach((el) => contentEl.appendChild(el));
  } else {
    contentEl.textContent = content;
    if (isError) contentEl.style.color = "red";
  }

  msgDiv.replaceChildren(contentEl);
}
