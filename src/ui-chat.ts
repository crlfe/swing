import { sendMessageStream, getSystemPrompt } from "./chat.ts";
import { type ChatConfig } from "./chat.ts";
import { ChatContext } from "./chat/context.ts";
import type { FileTree } from "./data/file-tree.ts";
import { h } from "./h.ts";

export function renderChat(fs: FileTree): void {
  const container = document.getElementById("chat-panel");
  if (!container) return;

  container.innerHTML = "";

  const savedUrl = localStorage.getItem("chat-url") || "http://localhost:11434/v1/chat/completions";
  const savedModel = localStorage.getItem("chat-model") || "gemma4:31b-cloud";
  const savedKey = localStorage.getItem("chat-key") || "";

  const overlay = h("div", { class: "chat-config-overlay", id: "chat-config-overlay" }, [
    h("div", { class: "chat-config-container" }, [
      h("div", { class: "chat-config-title" }, ["Chat Configuration"]),
      h("div", { class: "config-group" }, [
        h("label", {}, [
          "URL: ",
          h("input", {
            type: "text",
            id: "chat-url",
            value: savedUrl,
          }),
        ]),
        h("label", {}, [
          "Model: ",
          h("input", { type: "text", id: "chat-model", value: savedModel }),
        ]),
        h("label", {}, [
          "Key: ",
          h("input", { type: "password", id: "chat-key", value: savedKey }),
          "do not use for local ollama",
        ]),
      ]),
      h("button", { id: "chat-save-config" }, ["Save & Start Chatting"]),
    ]),
  ]);

  const main = h("div", { class: "chat-main" }, [
    h("div", { class: "chat-content", id: "chat-messages" }, [
      h("div", {}, ["Welcome! How can I help you today?"]),
    ]),
    h("div", { class: "chat-input-area" }, [
      h("textarea", { id: "chat-input", placeholder: "Ask something..." }),
      h("button", { id: "chat-send-btn" }, ["Send"]),
      h("button", { id: "chat-abort-btn", disabled: true }, ["Stop"]),
    ]),
  ]);

  container.append(h("div", { class: "chat-header" }, ["CHAT"]), overlay, main);

  const saveBtn = document.getElementById("chat-save-config") as HTMLButtonElement | null;

  main.style.display = "none";
  overlay.style.display = "flex";

  if (saveBtn) {
    saveBtn.onclick = () => {
      const url = (document.getElementById("chat-url") as HTMLInputElement)?.value || "";
      const model = (document.getElementById("chat-model") as HTMLInputElement)?.value || "";
      const key = (document.getElementById("chat-key") as HTMLInputElement)?.value || "";

      localStorage.setItem("chat-url", url);
      localStorage.setItem("chat-model", model);
      localStorage.setItem("chat-key", key);

      overlay.style.display = "none";
      main.style.display = "flex";
    };
  }

  const sendBtn = document.getElementById("chat-send-btn") as HTMLButtonElement | null;
  const abortBtn = document.getElementById("chat-abort-btn") as HTMLButtonElement | null;
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;

  const context = new ChatContext();
  context.addMessage({ role: "system", content: getSystemPrompt() });

  if (sendBtn && input && abortBtn) {
    sendBtn.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;

      let logElements: HTMLElement[] = [];
      let lastLog: HTMLElement | undefined;
      let lastLogType: "info" | "text" | "think" | "user" | null = null;

      const aiMsgDiv = h(
        "div",
        {
          style: { marginBottom: "10px", whiteSpace: "pre-wrap" },
        },
        [],
      );

      const messagesContainer = document.getElementById("chat-messages");
      if (messagesContainer) {
        messagesContainer.appendChild(aiMsgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }

      function log(msg: string, type: "info" | "text" | "think" | "user") {
        if (lastLog && lastLogType === type) {
          lastLog.textContent += msg;
        } else {
          const prefix = type === "user" ? "User: " : "";
          lastLog = h("div", { class: `log-type-${type}` }, [prefix + msg]);
          logElements.push(lastLog);
        }
        lastLogType = type;

        updateMessageContent(aiMsgDiv, logElements);
        const messagesContainer = document.getElementById("chat-messages");
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }

      const controller = new AbortController();
      const config: ChatConfig = {
        url: (document.getElementById("chat-url") as HTMLInputElement)?.value || "",
        model: (document.getElementById("chat-model") as HTMLInputElement)?.value || "",
        key: (document.getElementById("chat-key") as HTMLInputElement)?.value || "unspecified",
        stream: true,
        think: true,
        fs,
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

      updateMessageContent(aiMsgDiv, []);

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
          updateMessageContent(
            aiMsgDiv,
            `Error: ${e instanceof Error ? e.message : String(e)}`,
            true,
          );
        }
      } finally {
        sendBtn.disabled = false;
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
