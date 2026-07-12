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
    this.#profiles = JSON.parse(localStorage.getItem("chat-profiles") || "{}");
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
}
