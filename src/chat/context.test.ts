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
});
