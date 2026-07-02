import { type Tool } from "../chat/types.ts";

interface ForgetArgs {
  toolCallId: string;
}

const forgetTool: Tool = {
  definition: {
    type: "function",
    function: {
      name: "forget",
      description:
        "Removes a previous tool call and its response from the conversation history. This is useful when an old result is no longer needed. For example, an agent can use read_file, extract and summarize the important details for later reference, and then use forget to remove the large file content from the history.",
      parameters: {
        type: "object",
        properties: {
          toolCallId: { type: "string", description: "The ID of the tool call to remove" },
        },
        required: ["toolCallId"],
      },
    },
  },
  execute: async (args, { context }) => {
    const { toolCallId } = args as ForgetArgs;
    if (typeof toolCallId !== "string") {
      throw new Error("Argument 'toolCallId' must be a string");
    }

    try {
      if (!context.removeToolCall(toolCallId)) {
        return `ERR Tool call not found`;
      }
      return `OK forgotten tool call ${toolCallId}`;
    } catch (e: any) {
      return `ERR ${e.message}`;
    }
  },
};

export default forgetTool;
