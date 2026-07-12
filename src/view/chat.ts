import { sendMessageStream, type ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import type { FileTree } from "../data/file-tree.ts";
import { h } from "../h.ts";
import { ChatProfilesView, DEFAULT_SYSTEM_PROMPT } from "./chat-profiles.ts";

export class ChatView {
  public readonly view: HTMLElement;
  private readonly profiles = new ChatProfilesView();
  private readonly context = new ChatContext();

  constructor(private fs: FileTree) {
    const currentProfile = this.profiles.value;
    const systemPrompt = currentProfile?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.context.addMessage({
      role: "system",
      content: systemPrompt,
    });

    let messagesContainer: HTMLElement;
    let input: HTMLTextAreaElement;
    let sendBtn: HTMLButtonElement;
    let abortBtn: HTMLButtonElement;
    const main = h("div", { class: "chat-main" }, [
      (messagesContainer = h("div", { class: "chat-content", id: "chat-messages" }, [
        h("div", {}, ["Welcome! How can I help you today?"]),
      ])),
      h("div", { class: "chat-input-area" }, [
        (input = h("textarea", {
          id: "chat-input",
          placeholder: "Ask something...",
          onkeydown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendBtn.click();
            }
          },
        })),
        (sendBtn = h(
          "button",
          { onclick: () => this.sendClicked(input, messagesContainer, sendBtn, abortBtn) },
          ["Send"],
        )),
        (abortBtn = h("button", { disabled: true }, ["Stop"])),
        h(
          "button",
          {
            onclick: () => {
              this.context.clear();
              const currentProfile = this.profiles.value;
              const systemPrompt = currentProfile?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
              this.context.addMessage({
                role: "system",
                content: systemPrompt,
              });
              if (messagesContainer) {
                messagesContainer.innerHTML = "";
                messagesContainer.appendChild(h("div", {}, ["Chat history cleared."]));
              }
            },
          },
          ["Clear"],
        ),
      ]),
    ]);

    let resizeHandle: HTMLDivElement;
    this.view = h(
      "div",
      {
        id: "chat-panel",
        class: "chat-panel-content",
        style: { position: "relative" },
      },
      [
        (resizeHandle = createNSResizeHandle({
          onChange: (height) => {
            this.view.style.height = `${Math.max(height, 180)}px`;
          },
        })),
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

    const updateInputsDisabled = () => {
      const disabled = !this.profiles.value;
      input.disabled = disabled;
      sendBtn.disabled = disabled;
      // Abort button is managed separately during active requests

      main.style.display = disabled ? "none" : "flex";

      resizeHandle.style.display = disabled ? "none" : "block";

      if (disabled) {
        this.view.style.height = "";
      } else {
        this.view.style.height = `${window.innerHeight / 3}px`;
      }
    };

    updateInputsDisabled();
    if (currentProfile) {
      this.view.style.height = `${window.innerHeight / 3}px`;
    }

    this.profiles.onchange = () => {
      updateInputsDisabled();
    };
  }

  private async sendClicked(
    input: HTMLTextAreaElement,
    messagesContainer: HTMLElement,
    sendBtn: HTMLButtonElement,
    abortBtn: HTMLButtonElement,
  ) {
    const text = input.value.trim();
    if (!text) return;

    let lastLog: HTMLElement | undefined;
    let lastLogType: "info" | "text" | "think" | "user" | "error" | null = null;

    const aiMsgDiv = h("div", { style: { whiteSpace: "pre" } }, []);

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
        aiMsgDiv.appendChild(lastLog);
      }
      lastLogType = type;

      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    };

    const controller = new AbortController();
    const currentProfile = this.profiles.value;
    const config: ChatConfig = {
      url: currentProfile?.url || "http://localhost:11434/v1/chat/completions",
      model: currentProfile?.model || "gemma4:31b-cloud",
      key: currentProfile?.key || "unspecified",
      stream: true,
      think: true,
      fs: this.fs,
      context: this.context,
      abortController: controller,
      logInfo(msg: string) {
        log(msg + "\n", "info");
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
    } catch (error: any) {
      if (error.name === "AbortError") {
        if (!lastLog) {
          log(`Request aborted by user.`, "info");
        } else {
          log(" Request aborted by user.", "info");
        }
      } else {
        log(`Error: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    } finally {
      const isDisabled = !this.profiles.value;
      sendBtn.disabled = isDisabled;
      abortBtn.disabled = true;
      abortBtn.onclick = null;
    }
  }
}

function createNSResizeHandle(props: { onChange(height: number): void }): HTMLDivElement {
  const view = h("div", {
    class: "chat-resize-handle",
    onpointerdown(e) {
      e.preventDefault();
      view.setPointerCapture(e.pointerId);
      view.addEventListener("pointermove", handleMouseMove);
      view.addEventListener("pointerup", handleMouseUp);
    },
  });

  const handleMouseMove = (event: PointerEvent) => {
    props.onChange(window.innerHeight - event.clientY);
  };

  const handleMouseUp = () => {
    view.removeEventListener("pointermove", handleMouseMove);
    view.removeEventListener("pointerup", handleMouseUp);
  };

  return view;
}
