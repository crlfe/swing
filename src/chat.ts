import { type Files } from "./fs.ts";
import deleteFileTool from "./tools/delete_file.ts";
import listTreeTool from "./tools/list_tree.ts";
import moveFileTool from "./tools/move_file.ts";
import readBlockTool from "./tools/read_block.ts";
import readFileTool from "./tools/read_file.ts";
import readToplevelTool from "./tools/read_toplevel.ts";
import writeFileTool from "./tools/write_file.ts";
import type { Tool, ToolCall } from "./types.ts";

interface ChatConfig {
  url: string;
  model: string;
  key: string;
  stream?: boolean;
  fs: Files;
  logInfo: (msg: string) => void;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

const toolRegistry: Record<string, Tool> = {
  [readFileTool.definition.function.name]: readFileTool,
  [writeFileTool.definition.function.name]: writeFileTool,
  [deleteFileTool.definition.function.name]: deleteFileTool,
  [moveFileTool.definition.function.name]: moveFileTool,
  [listTreeTool.definition.function.name]: listTreeTool,
  [readToplevelTool.definition.function.name]: readToplevelTool,
  [readBlockTool.definition.function.name]: readBlockTool,
};

const tools = Object.values(toolRegistry).map((t) => t.definition);

async function executeTools(toolCalls: ToolCall[], config: ChatConfig): Promise<Message[]> {
  const toolResults: Message[] = [];
  for (const toolCall of toolCalls) {
    const tool = toolRegistry[toolCall.function.name];
    if (!tool) {
      throw new Error(`Unknown tool: ${toolCall.function.name}`);
    }
    const args = JSON.parse(toolCall.function.arguments);
    const result = await tool.execute(args, { logInfo: config.logInfo, fs: config.fs });
    toolResults.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: result,
    });
  }
  return toolResults;
}

export async function* sendMessageStream(messages: Message[], config: ChatConfig) {
  const streamEnabled = config.stream !== false;
  let currentMessages = [...messages];

  while (true) {
    const requestBody = {
      model: config.model,
      messages: currentMessages,
      temperature: 0.7,
      stream: streamEnabled,
      tools: tools,
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

      if (message.tool_calls && message.tool_calls.length > 0) {
        const toolResults = await executeTools(message.tool_calls, config);
        currentMessages = [...currentMessages, message, ...toolResults];
        // Continue to next iteration of the while loop
      } else {
        yield message.content;
        break;
      }
    } else {
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
        // Nothing more to do.
        break;
      }

      const toolResults = await executeTools(accumulatedMessage.tool_calls, config);
      currentMessages = [...currentMessages, accumulatedMessage, ...toolResults];
    }
  }
}

export function getSystemPrompt(): string {
  return "You are a helpful AI assistant integrated into a text editor. You are capable of helping the user write code, debug issues, and explain concepts. Be concise and professional.";
}
