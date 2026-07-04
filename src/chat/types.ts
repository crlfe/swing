/** Represents a single message in a chat conversation. */
export interface Message {
  /** The role of the message author. */
  role: "system" | "user" | "assistant" | "tool";
  /** The textual content of the message. */
  content: string;
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
  /** Details about the function to call. */
  function: {
    /** The name of the function. */
    name: string;
    /** The arguments provided as a JSON string. */
    arguments: string;
  };
}
