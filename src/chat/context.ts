import type { Message } from "./types.ts";

export class ChatContext {
  private messages: Message[] = [];

  /** Adds a message to the conversation history. */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /** Returns the current history of messages. */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Clears all messages from the history. */
  clear(): void {
    this.messages = [];
  }
}
