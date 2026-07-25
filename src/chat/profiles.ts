export interface ChatProfile {
  readonly url: string;
  readonly model: string;
  readonly key: string;
  readonly systemPrompt: string;
}

export type ChatProfiles = Record<string, ChatProfile>;

export class ChatProfilesManager {
  #profiles: ChatProfiles;
  #active: string;

  constructor() {
    const raw = localStorage.getItem("chat-profiles") || "{}";
    this.#profiles = this.#validateProfiles(raw);
    this.#active = localStorage.getItem("chat-active-profile") || "";
  }

  public get profiles(): ChatProfiles {
    return this.#profiles;
  }

  public set profiles(newProfiles: ChatProfiles) {
    this.#profiles = newProfiles;
    localStorage.setItem("chat-profiles", JSON.stringify(newProfiles));
  }

  public getActiveProfileName(): string {
    return this.#active;
  }

  public setActiveProfileName(value: string) {
    this.#active = value;
    localStorage.setItem("chat-active-profile", value);
  }

  public getActiveProfile(): ChatProfile | undefined {
    return this.#profiles[this.#active];
  }

  /**
   * Validates and parses a raw JSON string into a ChatProfiles object. Throws if the data is
   * malformed or contains invalid profiles.
   */
  #validateProfiles(raw: string): ChatProfiles {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("chat-profiles: stored data is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: ChatProfiles = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      result[key] = this.#validateProfile(key, value);
    }
    return result;
  }

  /**
   * Validates a single profile object, returning a normalized ChatProfile. Throws if any required
   * field is missing or has the wrong type.
   */
  #validateProfile(name: string, value: unknown): ChatProfile {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`chat-profiles: profile "${name}" must be an object`);
    }
    const obj = value as Record<string, unknown>;
    const url = obj["url"];
    const model = obj["model"];
    const key = obj["key"];
    const systemPrompt = obj["systemPrompt"];
    if (typeof url !== "string") {
      throw new Error(`chat-profiles: profile "${name}" is missing or has an invalid "url"`);
    }
    if (typeof model !== "string") {
      throw new Error(`chat-profiles: profile "${name}" is missing or has an invalid "model"`);
    }
    if (typeof key !== "string") {
      throw new Error(`chat-profiles: profile "${name}" is missing or has an invalid "key"`);
    }
    if (typeof systemPrompt !== "string") {
      throw new Error(
        `chat-profiles: profile "${name}" is missing or has an invalid "systemPrompt"`,
      );
    }
    return { url, model, key, systemPrompt };
  }
}
