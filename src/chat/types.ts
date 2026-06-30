import { type ChatConfig } from "../chat.ts";
import { type Files } from "../fs.ts";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: ToolFunctionDefinition;
}

export interface ToolOptions {
  logInfo?: (msg: string) => void;
  fs: Files;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: any, options: ChatConfig): Promise<string>;
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}
