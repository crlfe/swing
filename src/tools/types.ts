import type { ChatConfig } from "../chat.ts";
import type { ToolDefinition } from "../chat/types.ts";

/** An executable tool that can be called by the LLM. */
export interface Tool {
  /** The definition of the tool used to describe it to the LLM. */
  definition: ToolDefinition;
  /**
   * Executes the tool logic with the provided arguments.
   *
   * @param args - The arguments provided by the LLM.
   * @param options - The current chat configuration.
   * @param toolCallId - The ID of the tool call being executed.
   * @returns A promise that resolves to the result string of the tool execution.
   */
  execute(args: any, options: ChatConfig, toolCallId?: string): Promise<string>;
}
