#!/usr/bin/env node

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sendMessageStream, type ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { FileTree } from "../data/file-tree.ts";
import type { RecursiveRecord } from "../data/trees.ts";
import type { TreeDir, TreeNode } from "../data/types.ts";
import { DEFAULT_SYSTEM_PROMPT } from "../view/chat-profiles.ts";

async function loadFiles(path: string): Promise<FileTree> {
  async function walk(path: string): Promise<TreeDir> {
    const children = new Map<string, TreeNode>();

    const entries = await nodeFs.readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "dist", "node_modules", "pnpm-lock.yaml"].includes(entry.name)) {
        continue;
      }

      const entryPath = nodePath.resolve(entry.parentPath, entry.name);
      if (entry.isDirectory()) {
        children.set(entry.name, await walk(entryPath));
      } else {
        const content = await nodeFs.readFile(entryPath, "utf8");
        children.set(entry.name, { type: "blob", content: content.split("\n") });
      }
    }

    return { type: "dir", children };
  }
  return new FileTree(await walk(path));
}

async function saveFiles(root: string, files: FileTree): Promise<number> {
  let changed = 0;
  const rootHref = pathToFileURL(root).href.replace(/\/?$/, "/");
  await files.walkAsync("", async (path, node) => {
    if (node.type !== "blob") return;

    const content = node.content.join("\n");

    const entryPath = fileURLToPath(new URL(path, rootHref).href);

    let shouldWrite = true;
    try {
      await nodeFs.access(entryPath);
      const existingContent = await nodeFs.readFile(entryPath, "utf8");
      if (existingContent === content) {
        shouldWrite = false;
      }
    } catch {
      // File doesn't exist, so shouldWrite remains true
    }

    if (shouldWrite) {
      changed++;
      console.log("write", entryPath);
      await nodeFs.mkdir(nodePath.dirname(entryPath), { recursive: true });
      await nodeFs.writeFile(entryPath, content, "utf8");
    }
  });

  return changed;
}

async function run() {
  const chatUrl = process.env.OPENAI_BASE_URL;
  const chatKey = process.env.OPENAI_API_KEY ?? "none";
  const chatModel = process.env.OPENAI_MODEL ?? "auto";

  if (!chatUrl) {
    console.error("Missing required environment variables. Please set OPENAI_BASE_URL.");
    process.exit(1);
  }

  let lastLogType: "text" | "info" | "think" | undefined;

  const config: ChatConfig = {
    url: chatUrl.replace(/\/?$/, "/chat/completions"),
    model: chatModel,
    key: chatKey,
    stream: true,
    think: true,
    fs: await loadFiles(process.cwd()),
    context: new ChatContext(),

    logText(msg: string) {
      if (lastLogType && lastLogType !== "text") {
        process.stdout.write("\n\n");
      }
      lastLogType = "text";
      process.stdout.write(msg);
    },
    logInfo(msg: string) {
      if (lastLogType && lastLogType !== "info") {
        process.stdout.write("\n\n");
      }
      lastLogType = "info";
      process.stdout.write(msg + "\n");
    },
    logThink(msg: string) {
      if (lastLogType && lastLogType !== "think") {
        process.stdout.write("\n\n");
      }
      lastLogType = "think";
      process.stdout.write(`\x1b[2m${msg}\x1b[0m`);
    },
  };

  config.context.addMessage({ role: "system", content: DEFAULT_SYSTEM_PROMPT });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  process.on("SIGINT", () => {
    console.log("\nExiting...");
    process.exit(0);
  });

  console.log(`Loaded ${config.fs.size} files`);
  console.log("Commands: /load /save /quit");

  const askQuestion = () => {
    return new Promise<string>((resolve) => {
      console.log();
      rl.question("> ", (input) => resolve(input));
    });
  };

  while (true) {
    const userInput = await askQuestion();

    if (userInput === null || userInput === undefined) {
      break;
    }

    if (userInput.startsWith("/")) {
      if (userInput === "/load") {
        try {
          config.fs = await loadFiles(process.cwd());
          console.log(`Loaded ${config.fs.size} files`);
        } catch (e) {
          console.error("Error loading files:", e);
        }
      } else if (userInput === "/save") {
        try {
          const count = await saveFiles(process.cwd(), config.fs);
          console.log(`Saved ${count} files.`);
        } catch (e) {
          console.error("Error saving files:", e);
        }
      } else if (userInput === "/quit") {
        break;
      } else {
        console.error(`Unrecognized command ${JSON.stringify(userInput)}`);
      }

      continue;
    }

    config.context.addMessage({ role: "user", content: userInput });

    try {
      await sendMessageStream(config);
    } catch (e) {
      console.error("\nChat error:", e);
    }
  }

  rl.close();
}

run();
