import fs from "fs";
import path from "path";

import type { Plugin } from "vite";

interface FileSystemTree {
  [key: string]: string | FileSystemTree | null;
}

interface PluginOptions {
  ignore?: string[];
  dryRun?: boolean;
}

const PLUGIN_NAME = "dev-fs";

/** Vite plugin to provide read/write access to the source tree. */
export default function vitePluginDevFs(options: PluginOptions = {}): Plugin {
  const ignoreList = options.ignore || [".git", "dist", "node_modules"];
  const rootDir = process.cwd();

  if (!process.env.DEV_FS_KEY) {
    console.warn(`[${PLUGIN_NAME}] DEV_FS_KEY is not set. All access to /api/fs is denied.`);
  }

  // Helper to recursively read the directory tree
  function readTree(dir: string): FileSystemTree | string {
    const stats = fs.statSync(dir);
    if (stats.isDirectory()) {
      const files = fs.readdirSync(dir);
      const tree: FileSystemTree = {};

      for (const file of files) {
        if (ignoreList.includes(file)) continue;

        const fullPath = path.join(dir, file);
        const fileStats = fs.statSync(fullPath);

        if (fileStats.isDirectory()) {
          tree[file] = readTree(fullPath) as FileSystemTree;
        } else {
          tree[file] = fs.readFileSync(fullPath, "utf8");
        }
      }
      return tree;
    }
    return fs.readFileSync(dir, "utf8");
  }

  // Helper to recursively update/delete files from the tree
  function updateTree(dir: string, tree: FileSystemTree): void {
    const dryRun = options.dryRun;
    for (const [name, content] of Object.entries(tree)) {
      if (ignoreList.includes(name)) continue;

      if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
        throw new Error(
          `[${PLUGIN_NAME}] Security Error: Invalid file/directory name ${JSON.stringify(name)}`,
        );
      }

      const fullPath = path.resolve(dir, name);
      if (!fullPath.startsWith(rootDir)) {
        throw new Error(
          `[${PLUGIN_NAME}] Security Error: Attempted directory traversal to ${JSON.stringify(fullPath)}`,
        );
      }

      if (content === null) {
        // Delete file or directory
        if (fs.existsSync(fullPath)) {
          console.log(
            `[${PLUGIN_NAME}] ${dryRun ? "[DRY RUN] Would delete" : "Deleting"} ${JSON.stringify(fullPath)}`,
          );
          if (!dryRun) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        }
      } else if (typeof content === "object" && content !== null) {
        // Recurse into directory
        if (!fs.existsSync(fullPath)) {
          console.log(
            `[${PLUGIN_NAME}] ${dryRun ? "[DRY RUN] Would create directory" : "Creating directory"} ${JSON.stringify(fullPath)}`,
          );
          if (!dryRun) {
            fs.mkdirSync(fullPath, { recursive: true });
          }
        }
        updateTree(fullPath, content);
      } else if (typeof content === "string") {
        // Write file
        console.log(
          `[${PLUGIN_NAME}] ${dryRun ? "[DRY RUN] Would write" : "Writing"} ${JSON.stringify(fullPath)}`,
        );
        if (!dryRun) {
          fs.writeFileSync(fullPath, content, "utf8");
        }
      }
    }
  }

  return {
    name: PLUGIN_NAME,
    configureServer(server) {
      const bearerToken = process.env.DEV_FS_KEY;
      server.middlewares.use("/api/fs", async (req, res, next) => {
        if (!bearerToken || req.headers.authorization?.trim() !== `Bearer ${bearerToken}`) {
          if (!bearerToken) {
            console.warn(
              `[${PLUGIN_NAME}] DEV_FS_KEY is not set. All access to /api/fs is denied.`,
            );
          }

          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (req.method === "GET") {
          try {
            const tree = readTree(rootDir);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(tree));
          } catch (err: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
        } else if (req.method === "PATCH") {
          let chunks: Buffer[] = [];
          req.on("data", (chunk: string | Buffer) => {
            chunks.push(Buffer.from(chunk));
          });
          req.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            try {
              const tree: FileSystemTree = JSON.parse(body);
              updateTree(rootDir, tree);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true }));
            } catch (err: any) {
              console.error(err);
              res.statusCode = 400;
              res.end(JSON.stringify({ error: err.message }));
            }
          });
        } else {
          next();
        }
      });
    },
  };
}
