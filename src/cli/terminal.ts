#!/usr/bin/env node

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sendMessageStream, type ChatConfig } from "../chat.ts";
import { ChatContext } from "../chat/context.ts";
import { Files } from "../fs.ts";

async function loadFiles(base: string): Promise<Files> {
  // Ensure this has a trailing slash so it can be used as a prefix.
  const rootHref = pathToFileURL(base).href.replace(/\/?$/, "/");

  const files: Record<string, string> = {};

  async function walk(path: string) {
    const entries = await nodeFs.readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "dist", "node_modules", "pnpm-lock.yaml"].includes(entry.name)) {
        continue;
      }

      const entryPath = nodePath.resolve(entry.parentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else {
        const entryHref = pathToFileURL(entryPath).href;
        const entryRel = entryHref.slice(rootHref.length);
        const content = await nodeFs.readFile(entryPath, "utf8");
        files[entryRel] = content;
      }
    }
  }

  await walk(base);
  const filesInstance = new Files();
  filesInstance.fromJSON(files);
  return filesInstance;
}

async function saveFiles(root: string, files: Files): Promise<number> {
  let changed = 0;
  const rootHref = pathToFileURL(root).href.replace(/\/?$/, "/");

  for (const [entryRel, content] of Object.entries(files.toJSON())) {
    const entryHref = new URL(entryRel, rootHref).href;
    if (!entryHref.startsWith(rootHref)) {
      throw new Error("Assertion failed: Logic error or path traversal attack");
    }

    const entryPath = fileURLToPath(entryHref);

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
  }

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

  const config: ChatConfig = {
    url: chatUrl.replace(/\/?$/, "/chat/completions"),
    model: chatModel,
    key: chatKey,
    stream: true,
    fs: new Files(),

    logText(msg: string) {
      process.stdout.write(msg);
    },
    logInfo(msg: string) {
      process.stderr.write(msg + "\n");
    },
  };

  try {
    config.fs = await loadFiles(process.cwd());
  } catch (e) {
    console.error("Failed to load files:", e);
  }

  const systemPrompt = "You are a helpful AI assistant. Be concise and professional.";
  const context = new ChatContext();
  context.addMessage({ role: "system", content: systemPrompt });

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

    context.addMessage({ role: "user", content: userInput });

    try {
      await sendMessageStream(context, config);
    } catch (e) {
      console.error("\nChat error:", e);
    }
  }

  rl.close();
}

run();
