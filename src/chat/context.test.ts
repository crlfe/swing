import { describe, expect, it, beforeEach, vi } from "vitest";

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

// --- Persistence tests ---

describe("ChatContext persistence", () => {
  const storageKey = "test-chat-context";
  const mockStore = new Map<string, string>();

  beforeEach(() => {
    mockStore.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => mockStore.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStore.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        mockStore.delete(key);
      }),
      clear: vi.fn(() => {
        mockStore.clear();
      }),
    });
  });

  it("should not persist when no storage key is provided", () => {
    const ctx = new ChatContext();
    ctx.addMessage({ role: "user", content: "hi" });
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("should save messages to local storage after addMessage", () => {
    const ctx = new ChatContext({ storageKey });
    ctx.addMessage({ role: "user", content: "hello" });

    const stored = JSON.parse(localStorage.getItem(storageKey) as string);
    expect(stored.version).toBe(1);
    expect(stored.messages).toHaveLength(1);
    expect(stored.messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("should save messages to local storage after clear", () => {
    const ctx = new ChatContext({ storageKey });
    ctx.addMessage({ role: "user", content: "hello" });
    ctx.clear();

    const stored = JSON.parse(localStorage.getItem(storageKey) as string);
    expect(stored.messages).toEqual([]);
  });

  it("should save messages to local storage after removeToolCall", () => {
    const ctx = new ChatContext({ storageKey });
    ctx.addMessage({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", type: "function", function: { name: "test", arguments: "{}" } }],
    });
    ctx.removeToolCall("c1");

    const stored = JSON.parse(localStorage.getItem(storageKey) as string);
    expect(stored.messages).toEqual([]);
  });

  it("should save messages to local storage after updateToolResult", () => {
    const ctx = new ChatContext({ storageKey });
    ctx.addMessage({
      role: "assistant",
      content: "Hi",
      tool_calls: [{ id: "c1", type: "function", function: { name: "test", arguments: "{}" } }],
    });
    ctx.addMessage({ role: "tool", tool_call_id: "c1", content: "old" });
    ctx.updateToolResult("c1", "result");

    const stored = JSON.parse(localStorage.getItem(storageKey) as string);
    expect(stored.messages).toHaveLength(2);
  });

  it("should load messages from local storage on construction", () => {
    const savedMessages: Message[] = [{ role: "user", content: "restored" }];
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, messages: savedMessages }));

    const ctx = new ChatContext({ storageKey });
    expect(ctx.getMessages()).toEqual(savedMessages);
  });

  it("should ignore stored data with an incompatible version", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ version: 99, messages: [{ role: "user", content: "old" }] }),
    );

    const ctx = new ChatContext({ storageKey });
    expect(ctx.getMessages()).toEqual([]);
  });

  it("should ignore stored data with missing messages array", () => {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1 }));

    const ctx = new ChatContext({ storageKey });
    expect(ctx.getMessages()).toEqual([]);
  });

  it("should ignore corrupted JSON in local storage", () => {
    localStorage.setItem(storageKey, "not-json");

    const ctx = new ChatContext({ storageKey });
    expect(ctx.getMessages()).toEqual([]);
  });

  it("should be ephemeral (no load/save) when storageKey is not provided", () => {
    const ctx = new ChatContext();
    ctx.addMessage({ role: "user", content: "ephemeral" });
    expect(ctx.getMessages()).toEqual([{ role: "user", content: "ephemeral" }]);
  });
  it("should save and reload an identical list of messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello!" },
      {
        role: "assistant",
        content: "I can help. Let me check the files.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "list_files", arguments: '{"path": "."}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "file1.ts, file2.ts" },
      { role: "assistant", content: "I see the files." },
    ];

    const ctx1 = new ChatContext({ storageKey });
    messages.forEach((msg) => ctx1.addMessage(msg));

    const ctx2 = new ChatContext({ storageKey });
    expect(ctx2.getMessages()).toEqual(messages);
  });
});
