/** Represents a single message in a chat conversation. */
export interface Message {
  /** The role of the message author. */
  role: "system" | "user" | "assistant" | "tool";
  /** The textual content of the message. */
  content: string;
  /** The reasoning content of the message, if any. */
  reasoning_content?: string;
  /** Optional tool calls requested by the assistant. */
  tool_calls?: ToolCall[];
  /** The ID of the tool call this message is responding to (used when role is 'tool'). */
  tool_call_id?: string;
}

/** Represents a tool definition for the LLM. */
export interface ToolDefinition {
  /** The type of tool, currently only 'function' is supported. */
  type: "function";
  /** The function definition for this tool. */
  function: ToolFunctionDefinition;
}

/** Defines the schema and description of a tool function. */
export interface ToolFunctionDefinition {
  /** The name of the function to be called. */
  name: string;
  /** A description of what the function does. */
  description: string;
  /** The JSON schema for the function parameters. */
  parameters: Record<string, unknown>;
}

/** Represents a tool call request from the LLM. */
export interface ToolCall {
  /** Unique identifier for the tool call. */
  id: string;
  /** The type of tool call. */
  type: string;
  /** Details about the function to be called. */
  function: {
    /** The name of the function. */
    name: string;
    /** The arguments provided as a JSON string. */
    arguments: string;
  };
}

/** OpenAI-compatible Chat Completion response. */
export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
}

export interface ChatCompletionChoice {
  index: number;
  message: Message;
  finish_reason: string;
}

/** OpenAI-compatible Chat Completion chunk for streaming. */
export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChoiceDelta[];
  usage?: ChatCompletionUsage; // Added this
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens: number;
  };
}

export interface ChatCompletionChoiceDelta {
  index: number;
  delta: ChatCompletionDelta;
  finish_reason?: string;
}

export interface ChatCompletionDelta {
  content?: string;
  reasoning_content?: string;
  tool_calls?: ChatCompletionToolCallDelta[];
}

export interface ChatCompletionToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}
