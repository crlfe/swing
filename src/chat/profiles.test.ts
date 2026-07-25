import { describe, expect, it, vi } from "vitest";

import { ChatProfilesManager } from "./profiles.ts";

describe("ChatProfilesManager validation", () => {
  it("should load an empty profiles object when localStorage is empty", () => {
    const mockGetItem = vi.fn().mockReturnValue(null);
    const mockSetItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: mockSetItem });

    const m = new ChatProfilesManager();
    expect(m.profiles).toEqual({});
    expect(mockGetItem).toHaveBeenCalledWith("chat-profiles");
  });

  it("should load profiles from localStorage when valid", () => {
    const validProfile = {
      url: "https://api.example.com",
      model: "gpt-4",
      key: "sk-abc123",
      systemPrompt: "You are a helpful assistant.",
    };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ myprofile: validProfile });
      if (key === "chat-active-profile") return "myprofile";
      return null;
    });
    const mockSetItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: mockSetItem });

    const m = new ChatProfilesManager();
    expect(m.profiles).toEqual({ myprofile: validProfile });
    expect(m.getActiveProfile()).toEqual(validProfile);
  });

  it("should throw when stored data is not valid JSON", () => {
    const mockGetItem = vi.fn(() => "not-json");
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow("not valid JSON");
  });

  it("should return empty profiles when stored data is null", () => {
    const mockGetItem = vi.fn(() => "null");
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    const m = new ChatProfilesManager();
    expect(m.profiles).toEqual({});
  });

  it("should return empty profiles when stored data is an array", () => {
    const mockGetItem = vi.fn(() => "[]");
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    const m = new ChatProfilesManager();
    expect(m.profiles).toEqual({});
  });

  it("should return empty profiles when stored data is a string", () => {
    const mockGetItem = vi.fn(() => '"string"');
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    const m = new ChatProfilesManager();
    expect(m.profiles).toEqual({});
  });

  it("should throw when a profile is missing the url field", () => {
    const invalidProfile = { model: "gpt-4", key: "sk-abc", systemPrompt: "Help." };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: invalidProfile });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/missing or has an invalid "url"/);
  });

  it("should throw when a profile has a non-string url", () => {
    const invalidProfile = { url: 123, model: "gpt-4", key: "sk-abc", systemPrompt: "Help." };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: invalidProfile });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/invalid "url"/);
  });

  it("should throw when a profile is missing the model field", () => {
    const invalidProfile = { url: "https://api.example.com", key: "sk-abc", systemPrompt: "Help." };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: invalidProfile });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/missing or has an invalid "model"/);
  });

  it("should throw when a profile is missing the key field", () => {
    const invalidProfile = {
      url: "https://api.example.com",
      model: "gpt-4",
      systemPrompt: "Help.",
    };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: invalidProfile });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/missing or has an invalid "key"/);
  });

  it("should throw when a profile is missing the systemPrompt field", () => {
    const invalidProfile = { url: "https://api.example.com", model: "gpt-4", key: "sk-abc" };
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: invalidProfile });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/missing or has an invalid "systemPrompt"/);
  });

  it("should throw when a profile value is not an object", () => {
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: "not-an-object" });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/must be an object/);
  });

  it("should throw when a profile value is null", () => {
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: null });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/must be an object/);
  });

  it("should throw when a profile value is an array", () => {
    const mockGetItem = vi.fn((key: string) => {
      if (key === "chat-profiles") return JSON.stringify({ bad: [] });
      return null;
    });
    vi.stubGlobal("localStorage", { getItem: mockGetItem, setItem: vi.fn() });

    expect(() => new ChatProfilesManager()).toThrow(/must be an object/);
  });
});
