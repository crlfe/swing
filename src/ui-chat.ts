import { sendMessageStream, getSystemPrompt } from "./chat.ts";
import { type Files } from "./fs.ts";
import { h } from "./h.ts";

interface ChatConfig {
  url: string;
  model: string;
  key: string;
  stream: boolean;
  fs: Files;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function renderChat(fs: Files): void {
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
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;

  let chatHistory: ChatMessage[] = [{ role: "system", content: getSystemPrompt() }];

  if (sendBtn && input) {
    sendBtn.onclick = async () => {
      const text = input.value.trim();
      if (!text) return;

      const config: ChatConfig = {
        url: (document.getElementById("chat-url") as HTMLInputElement)?.value || "",
        model: (document.getElementById("chat-model") as HTMLInputElement)?.value || "",
        key: (document.getElementById("chat-key") as HTMLInputElement)?.value || "unspecified",
        stream: true,
        fs,
      };

      appendMessage("User", text);
      input.value = "";
      chatHistory.push({ role: "user", content: text });

      const aiMsgDiv = appendMessage("AI", "");
      let fullResponse = "";

      try {
        const stream = sendMessageStream(chatHistory, config);
        for await (const chunk of stream) {
          fullResponse += chunk;
          updateMessageContent(aiMsgDiv, "AI", fullResponse);
          const messagesContainer = document.getElementById("chat-messages");
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }
        chatHistory.push({ role: "assistant", content: fullResponse });
      } catch (e) {
        updateMessageContent(
          aiMsgDiv,
          "AI",
          `Error: ${e instanceof Error ? e.message : String(e)}`,
          true,
        );
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
  sender: string,
  text: string,
  isError = false,
): void {
  msgDiv.replaceChildren(
    h("strong", { style: { color: "#666" } }, [`${sender}:`]),
    " ",
    h("span", { style: isError ? { color: "red" } : {} }, [text]),
  );
}

function appendMessage(sender: string, text: string): HTMLElement {
  const messagesContainer = document.getElementById("chat-messages");
  const msgDiv = h(
    "div",
    {
      style: { marginBottom: "10px", whiteSpace: "pre-wrap" },
    },
    [],
  );

  updateMessageContent(msgDiv, sender, text);

  if (messagesContainer) {
    messagesContainer.appendChild(msgDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  return msgDiv;
}
