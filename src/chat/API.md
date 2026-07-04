# Chat API Overview

This directory provides the core types and state management for chat conversations, specifically
handling message history and tool integration.

## `ChatContext`

Manages the conversation state and history.

- `addMessage(message: Message): void`: Adds a new message to the history.
- `getMessages(): Message[]`: Returns a copy of the current conversation history.
- `clear(): void`: Wipes all messages from the history.
- `removeToolCall(toolCallId: string): boolean`: Removes tool calls and their corresponding results
  associated with a specific ID.
- `getToolResult(toolCallId: string): string | undefined`: Retrieves the result content of a
  specific tool call.
- `updateToolResult(toolCallId: string, content: string): boolean`: Replaces an existing tool result
  with new content.

## `Message`

Represents a single turn in the conversation.

- `role`: The role of the message sender (`"system"`, `"user"`, `"assistant"`, or `"tool"`).
- `content`: The text content of the message.
- `tool_calls?`: An array of `ToolCall` objects (used by the assistant).
- `tool_call_id?`: The ID of the tool call this message is responding to (used by the tool role).

## `ToolDefinition`

Defines how external functions are described to the LLM.

- `type`: The type of tool (currently always `"function"`).
- `function`: A `ToolFunctionDefinition` object.

## `ToolFunctionDefinition`

The detailed specification of a tool's function.

- `name`: The name of the function.
- `description`: A description of what the function does.
- `parameters`: The JSON schema for the function parameters.

## `ToolCall`

Represents a request from the LLM to execute a specific tool.

- `id`: Unique identifier for the call.
- `type`: The type of the tool call.
- `function`: Contains the `name` of the tool and the `arguments` (as a JSON string).
