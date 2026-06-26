import { type Files } from "./fs";
import { deleteFileTool } from "./tools/delete_file";
import { listDirectoryTreeTool } from "./tools/list_directory_tree";
import { moveFileTool } from "./tools/move_file";
import { readFileTool } from "./tools/read_file";
import { writeFileTool } from "./tools/write_file";
import type { Tool, ToolCall, ToolOptions } from "./types";

interface ChatConfig {
  url: string;
  model: string;
  key: string;
  stream?: boolean;
  fs: Files;
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export async function* sendMessageStream(messages: Message[], config: ChatConfig) {
  const { url, model, key, fs } = config;
  const streamEnabled = config.stream !== false;

  const toolRegistry: Record<string, Tool> = {
    [readFileTool.definition.function.name]: readFileTool,
    [writeFileTool.definition.function.name]: writeFileTool,
    [deleteFileTool.definition.function.name]: deleteFileTool,
    [moveFileTool.definition.function.name]: moveFileTool,
    [listDirectoryTreeTool.definition.function.name]: listDirectoryTreeTool,
  };

  const tools = Object.values(toolRegistry).map((t) => t.definition);

  const executeTool = async (toolCall: ToolCall, options: ToolOptions) => {
    const tool = toolRegistry[toolCall.function.name];
    if (!tool) {
      throw new Error(`Unknown tool: ${toolCall.function.name}`);
    }
    const args = JSON.parse(toolCall.function.arguments);
    return await tool.execute(args, options);
  };

  async function* requestLoop(currentMessages: Message[]): AsyncGenerator<string> {
    const requestBody = {
      model: model,
      messages: currentMessages,
      temperature: 0.7,
      stream: streamEnabled,
      tools: tools,
    };

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key !== "not-needed" ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      if (e instanceof TypeError && e.message === "Failed to fetch") {
        throw new Error(
          "Network error occurred. This may be due to a CORS issue. If you are using Ollama, you may need to set the OLLAMA_ORIGINS environment variable. See: https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama",
        );
      }
      throw e;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    if (!streamEnabled) {
      const data = await response.json();
      const message = data.choices[0].message;

      if (message.tool_calls) {
        const toolResults: Message[] = [];
        for (const toolCall of message.tool_calls) {
          const result = await executeTool(toolCall, { logInfo: (msg) => console.log(msg), fs });
          toolResults.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: result,
          });
        }

        const nextMessages = [...currentMessages, message, ...toolResults];
        yield* requestLoop(nextMessages);
      } else {
        yield message.content;
      }
      return;
    }

    // Streaming path
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Failed to get reader");

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedMessage: Message = { role: "assistant", content: "", tool_calls: [] };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data: ")) {
          try {
            const json = JSON.parse(trimmed.substring(6));
            const delta = json.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              accumulatedMessage.content += delta.content;
              yield delta.content;
            }

            if (delta.tool_calls) {
              for (const tcDelta of delta.tool_calls) {
                const index = tcDelta.index;
                if (!accumulatedMessage.tool_calls?.[index]) {
                  accumulatedMessage.tool_calls = accumulatedMessage.tool_calls || [];
                  accumulatedMessage.tool_calls[index] = {
                    id: "",
                    function: { name: "", arguments: "" },
                  };
                }

                const tc = accumulatedMessage.tool_calls[index];
                if (tcDelta.id) tc.id = tcDelta.id;
                if (tcDelta.function?.name) tc.function.name += tcDelta.function.name;
                if (tcDelta.function?.arguments)
                  tc.function.arguments += tcDelta.function.arguments;
              }
            }
          } catch (e) {
            console.error("Error parsing stream chunk:", e);
          }
        }
      }
    }

    if (accumulatedMessage.tool_calls && accumulatedMessage.tool_calls.length > 0) {
      const toolResults: Message[] = [];
      for (const toolCall of accumulatedMessage.tool_calls) {
        yield "\n[Tool: ${toolCall.function.name}]... ";

        const result = await executeTool(toolCall, { logInfo: () => {}, fs });

        const args = JSON.parse(toolCall.function.arguments);
        let detail = "executing";
        if (toolCall.function.name === "read_file") {
          detail = `reading ${args.path}`;
        } else if (toolCall.function.name === "write_file") {
          detail = `writing to ${args.path}`;
        } else if (toolCall.function.name === "delete_file") {
          detail = `deleting ${args.path}`;
        } else if (toolCall.function.name === "move_file") {
          detail = `moving ${args.oldPath} to ${args.newPath}`;
        } else if (toolCall.function.name === "list_directory_tree") {
          detail = `listing tree`;
        }

        yield `Executing ${toolCall.function.name} ${detail}.\n`;

        toolResults.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      const nextMessages = [...currentMessages, accumulatedMessage, ...toolResults];
      yield* requestLoop(nextMessages);
    }
  }

  try {
    yield* requestLoop([...messages]);
  } catch (e) {
    console.error("Chat error:", e);
    throw e;
  }
}

export function getSystemPrompt(): string {
  return "You are a helpful AI assistant integrated into a text editor. You can help the user write code, debug issues, and explain concepts. Be concise and professional.";
}
