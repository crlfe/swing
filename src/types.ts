import { type Files } from "./fs.ts";

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

export type ToolExecutor = (args: any, options: ToolOptions) => Promise<string>;

export interface Tool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}
