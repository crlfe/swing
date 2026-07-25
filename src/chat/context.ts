import type { Message } from "./types.ts";

const CURRENT_VERSION = 1;

interface ChatContextOptions {
  storageKey?: string;
}

/** Manages the state and history of a chat conversation. */
export class ChatContext {
  private messages: Message[] = [];
  private readonly storageKey: string | undefined;

  /**
   * Creates a new ChatContext.
   *
   * @param options - Optional configuration. When `storageKey` is provided, messages are loaded
   *   from and saved to local storage automatically.
   */
  constructor(options?: ChatContextOptions) {
    this.storageKey = options?.storageKey;

    if (this.storageKey) {
      this.#load();
    }
  }

  /**
   * Adds a message to the conversation history.
   *
   * @param message - The message to add.
   */
  addMessage(message: Message): void {
    this.messages.push(message);
    this.#save();
  }

  /** Returns true if there are no messages in the history. */
  isEmpty(): boolean {
    return this.messages.length === 0;
  }

  /**
   * Returns a copy of the current history of messages.
   *
   * @returns An array of messages in the conversation.
   */
  /**
   * Returns a copy of the current history of messages.
   *
   * @returns An array of messages in the conversation.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Clears all messages from the history. */
  clear(): void {
    this.messages = [];
    this.#save();
  }

  /**
   * Removes any tool calls or results matching the given tool call ID.
   *
   * @param toolCallId - The ID of the tool call to remove.
   * @returns True if any messages or tool calls were removed, false otherwise.
   */
  removeToolCall(toolCallId: string): boolean {
    const length = this.messages.length;
    this.messages = this.messages.filter((message) => {
      if (message.tool_calls) {
        message.tool_calls = message.tool_calls.filter((call) => call.id !== toolCallId);
        return message.tool_calls.length > 0 || message.content;
      }
      if (message.tool_call_id === toolCallId) {
        return false;
      }
      return true;
    });
    const changed = this.messages.length < length;
    if (changed) {
      this.#save();
    }
    return changed;
  }

  /**
   * Returns the result of a tool call by its ID.
   *
   * @param toolCallId - The ID of the tool call.
   * @returns The content of the tool result message, or undefined if not found.
   */
  getToolResult(toolCallId: string): string | undefined {
    const message = this.messages.find((m) => m.tool_call_id === toolCallId);
    return message?.content;
  }

  /**
   * Removes all messages with the given tool call ID and appends a new result message.
   *
   * @param toolCallId - The ID of the tool call to update.
   * @param content - The new result content.
   * @returns True if the tool call was found and updated, false otherwise.
   */
  updateToolResult(toolCallId: string, content: string): boolean {
    const exists = this.messages.some((m) => m.tool_call_id === toolCallId);
    if (!exists) {
      return false;
    }
    this.messages = this.messages.filter((message) => message.tool_call_id !== toolCallId);
    this.addMessage({
      role: "tool",
      tool_call_id: toolCallId,
      content: content,
    });
    this.#save();
    return true;
  }

  /** Loads messages from local storage, if a storage key is configured. */
  #load(): void {
    if (!this.storageKey) return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version === CURRENT_VERSION && Array.isArray(data?.messages)) {
        this.messages = data.messages;
      }
    } catch {
      // Ignore corrupted or incompatible stored data.
    }
  }

  /** Saves messages to local storage, if a storage key is configured. */
  #save(): void {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ version: CURRENT_VERSION, messages: this.messages }),
      );
    } catch {
      // Ignore storage errors (e.g. quota exceeded).
    }
  }
}
