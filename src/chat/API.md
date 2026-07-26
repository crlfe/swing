# Chat API Overview

This directory provides the core types and state management for chat conversations, specifically
handling message history and tool integration.

## `ChatContext`

Manages the conversation state and history.

### Constructor

- `new ChatContext(options?: { storageKey?: string })`: Creates a new chat context. When
  `storageKey` is provided, messages are automatically loaded from and saved to local storage (with
  versioning) so they survive page reloads. Without `storageKey`, the context is ephemeral and holds
  no messages on reload.

### Methods

- `addMessage(message: Message): void`: Adds a new message to the history. Persists to storage if
  configured.
- `getMessages(): Message[]`: Returns a copy of the current conversation history.
- `isEmpty(): boolean`: Returns true if there are no messages in the history.
- `clear(): void`: Wipes all messages from the history. Persists to storage if configured.
- `removeToolCall(toolCallId: string): boolean`: Removes tool calls and their corresponding results
  associated with a specific ID. Persists to storage if configured.
- `getToolResult(toolCallId: string): string | undefined`: Retrieves the result content of a
  specific tool call.
- `updateToolResult(toolCallId: string, content: string): boolean`: Replaces an existing tool result
  with new content. Persists to storage if configured.

## `Message`

Represents a single turn in the conversation.

- `role`: The role of the message sender (`"system"`, `"user"`, `"assistant"`, or `"tool"`).
- `content`: The text content of the message.
- `reasoning_content?`: The reasoning content of the message, if any.
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

## Streaming Types

OpenAI-compatible chat completion response types for both full responses and streaming chunks.

- `ChatCompletion`: Represents a full chat completion response.
- `ChatCompletionChoice`: A single choice within a completion response.
- `ChatCompletionChunk`: Represents a single chunk of a streaming completion response.
- `ChatCompletionChoiceDelta`: Delta data for a single choice in a streaming chunk.
- `ChatCompletionDelta`: The streaming delta for a single message, may contain `content`,
  `reasoning_content`, or `tool_calls`. See `ChatCompletionDelta` in `types.ts` for the full type
  definition including `reasoning_content` and `tool_calls` sub-fields.
- `ChatCompletionToolCallDelta`: Delta data for a tool call within a streaming chunk.
