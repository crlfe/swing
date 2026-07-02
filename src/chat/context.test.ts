import { describe, it, expect, beforeEach } from "vitest";

import { ChatContext } from "./context.ts";
import type { Message } from "./types.ts";

describe("ChatContext", () => {
  let context: ChatContext;

  beforeEach(() => {
    context = new ChatContext();
  });

  it("should start with an empty message list", () => {
    expect(context.getMessages()).toEqual([]);
  });

  it("should add messages to the history", () => {
    const msg: Message = { role: "user", content: "Hello!" };
    context.addMessage(msg);

    const messages = context.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
  });

  it("should maintain the order of added messages", () => {
    const msg1: Message = { role: "user", content: "Hi" };
    const msg2: Message = { role: "assistant", content: "Hello" };

    context.addMessage(msg1);
    context.addMessage(msg2);

    const messages = context.getMessages();
    expect(messages).toEqual([msg1, msg2]);
  });

  it("should clear the message history", () => {
    const msg: Message = { role: "user", content: "Test" };
    context.addMessage(msg);
    expect(context.getMessages()).toHaveLength(1);

    context.clear();
    expect(context.getMessages()).toEqual([]);
  });

  it("should return a copy of the messages array to prevent external mutation", () => {
    const msg: Message = { role: "user", content: "Immutable test" };
    context.addMessage(msg);

    const messages = context.getMessages();
    messages.push({ role: "system", content: "Hack" });

    expect(context.getMessages()).toHaveLength(1);
    expect(context.getMessages()[0]).toEqual(msg);
  });

  it("should remove tool calls and results by ID", () => {
    const toolCallId = "call_123";
    const assistantMsg: Message = {
      role: "assistant",
      content: "Let me check that for you.",
      tool_calls: [
        { id: toolCallId, type: "function", function: { name: "get_weather", arguments: "{}" } },
        { id: "call_456", type: "function", function: { name: "get_time", arguments: "{}" } },
      ],
    };
    const toolResultMsg: Message = {
      role: "tool",
      tool_call_id: toolCallId,
      content: "Sunny, 25C",
    };
    const otherToolResultMsg: Message = {
      role: "tool",
      tool_call_id: "call_456",
      content: "12:00 PM",
    };

    context.addMessage(assistantMsg);
    context.addMessage(toolResultMsg);
    context.addMessage(otherToolResultMsg);

    context.removeToolCall(toolCallId);

    const messages = context.getMessages();
    expect(messages).toHaveLength(2);

    // Check assistant message: tool_call_123 should be gone, call_456 should remain
    const updatedAssistant = messages.find((m) => m.role === "assistant");
    expect(updatedAssistant?.tool_calls).toHaveLength(1);
    expect(updatedAssistant?.tool_calls?.[0]?.id).toBe("call_456");

    // Check tool messages: tool_call_123 should be gone
    expect(messages.find((m) => m.tool_call_id === toolCallId)).toBeUndefined();
    expect(messages.find((m) => m.tool_call_id === "call_456")).toBeDefined();
  });

  it("should remove assistant message if it becomes empty after removing tool calls", () => {
    const toolCallId = "call_123";
    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: toolCallId, type: "function", function: { name: "test", arguments: "{}" } },
      ],
    };
    context.addMessage(assistantMsg);
    context.removeToolCall(toolCallId);
    expect(context.getMessages()).toHaveLength(0);
  });

  it("should update tool result by removing old result and appending new one", () => {
    const toolCallId = "call_123";
    const assistantMsg: Message = {
      role: "assistant",
      content: "Checking...",
      tool_calls: [
        { id: toolCallId, type: "function", function: { name: "test", arguments: "{}" } },
      ],
    };
    const toolResultMsg: Message = {
      role: "tool",
      tool_call_id: toolCallId,
      content: "Old Result",
    };

    context.addMessage(assistantMsg);
    context.addMessage(toolResultMsg);

    context.updateToolResult(toolCallId, "New Result");

    const messages = context.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(assistantMsg);
    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: toolCallId,
      content: "New Result",
    });
  });

  it("should retrieve the result of a tool call by ID", () => {
    const toolCallId = "call_789";
    const toolResultMsg: Message = {
      role: "tool",
      tool_call_id: toolCallId,
      content: "Specific Result",
    };
    context.addMessage(toolResultMsg);

    expect(context.getToolResult(toolCallId)).toBe("Specific Result");
  });

  it("should return undefined for a non-existent tool call ID", () => {
    expect(context.getToolResult("non-existent")).toBeUndefined();
  });
});
