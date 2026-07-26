import type { ChatContext } from "./chat/context.ts";
import type { ChatCompletion, ChatCompletionChunk, Message, ToolCall } from "./chat/types.ts";
import type { FileTree } from "./data/file-tree.ts";
import deleteFileTool from "./tools/delete_file.ts";
import editLinesTool from "./tools/edit_lines.ts";
import listFilesTool from "./tools/list_files.ts";
import moveFileTool from "./tools/move_file.ts";
import readFileTool from "./tools/read_file.ts";
import searchFilesTool from "./tools/search_files.ts";
import type { Tool } from "./tools/types.ts";
import writeFileTool from "./tools/write_file.ts";

export interface ChatConfig {
  url: string;
  model: string;
  key: string | undefined;
  stream?: boolean;
  think?: boolean;
  fs: FileTree;
  context: ChatContext;
  abortController?: AbortController;

  logText(msg: string): void;
  logInfo(msg: string): void;
  logThink(msg: string): void;
}

const toolRegistry: Record<string, Tool> = {
  [listFilesTool.definition.function.name]: listFilesTool,
  [readFileTool.definition.function.name]: readFileTool,
  [searchFilesTool.definition.function.name]: searchFilesTool,
  [editLinesTool.definition.function.name]: editLinesTool,
  [writeFileTool.definition.function.name]: writeFileTool,
  [moveFileTool.definition.function.name]: moveFileTool,
  [deleteFileTool.definition.function.name]: deleteFileTool,
};

const tools = Object.values(toolRegistry).map((t) => t.definition);

async function executeTools(toolCalls: ToolCall[], config: ChatConfig): Promise<Message[]> {
  const toolResults: Message[] = [];
  for (const toolCall of toolCalls) {
    const tool = toolRegistry[toolCall.function.name];
    if (!tool) {
      const message = `Unknown tool: ${toolCall.function.name}`;
      config.logInfo(message);
      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: `ERR ${message}`,
      });
      continue;
    }
    let result;
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const rawResult = await tool.execute(args, config, toolCall.id);
      result = `OK ${rawResult}`;
      const firstLine = rawResult.split("\n")[0];
      if (firstLine) {
        config.logInfo(firstLine);
      }
    } catch (e: any) {
      result = `ERR ${e.message}`;
      config.logInfo(e.message);
    }
    toolResults.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: result,
    });
  }
  return toolResults;
}

export async function sendMessageStream(config: ChatConfig) {
  const streamEnabled = config.stream !== false;

  while (true) {
    const currentMessages = config.context.getMessages();
    const requestBody = {
      model: config.model,
      messages: currentMessages,
      stream: streamEnabled,
      think: !!config.think,
      tools: tools,
      stream_options: streamEnabled ? { include_usage: true } : undefined,
    };

    let response;
    try {
      response = await fetch(config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}),
        },
        body: JSON.stringify(requestBody),
        signal: config.abortController?.signal,
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
      throw new Error(
        errorData.error
          ? JSON.stringify(errorData.error)
          : `HTTP error! status: ${response.status}`,
      );
    }

    if (!streamEnabled) {
      const data = (await response.json()) as ChatCompletion;
      const message = data.choices[0]?.message;
      if (!message) {
        break;
      }

      if (data.usage) {
        config.context.updateUsage(data.usage);
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolResults = await executeTools(message.tool_calls, config);
        config.context.addMessage(message);
        for (const res of toolResults) {
          config.context.addMessage(res);
        }
        // Continue to next iteration of the while loop
      } else {
        config.context.addMessage(message);
        if (message.content) config.logText(message.content);
        break;
      }
    } else {
      // Streaming path
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get reader");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedMessage: Message = {
        role: "assistant",
        content: "",
        reasoning_content: "",
        tool_calls: [],
      };

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
              const json = JSON.parse(trimmed.substring(6)) as ChatCompletionChunk;

              if (json.usage) {
                config.context.updateUsage(json.usage);
              }

              const delta = json.choices[0]?.delta;
              if (!delta) continue;

              if (delta.content) {
                accumulatedMessage.content += delta.content;
                config.logText(delta.content);
              }

              if (delta.reasoning_content) {
                accumulatedMessage.reasoning_content += delta.reasoning_content;
                config.logThink(delta.reasoning_content);
              }

              if (delta.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                  const index = tcDelta.index;
                  if (index == undefined) continue;

                  accumulatedMessage.tool_calls = accumulatedMessage.tool_calls || [];
                  if (!accumulatedMessage.tool_calls[index]) {
                    accumulatedMessage.tool_calls[index] = {
                      id: "",
                      type: "function",
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

      if (!accumulatedMessage.tool_calls?.length) {
        config.context.addMessage(accumulatedMessage);
        break;
      }

      const toolResults = await executeTools(accumulatedMessage.tool_calls, config);
      config.context.addMessage(accumulatedMessage);
      for (const res of toolResults) {
        config.context.addMessage(res);
      }
    }
  }
}
