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

  /** Removes any tool calls or results matching the given tool call ID. */
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
    return this.messages.length < length;
  }

  /** Returns the result of a tool call by its ID. */
  getToolResult(toolCallId: string): string | undefined {
    const message = this.messages.find((m) => m.tool_call_id === toolCallId);
    return message?.content;
  }

  /**
   * Removes all messages with the given tool call ID and appends a new result message. Returns
   * false if the tool call was not found.
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
    return true;
  }
}
