import nodeFs from "node:fs";
import nodeHttp from "node:http";
import nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { type Plugin } from "vite";

const LOCAL_EDIT_TOKEN = process.env.LOCAL_EDIT_TOKEN;

export default function localEditPlugin(): Plugin {
  const rootNativePath = nodePath.resolve(".");

  // Ensure there is a trailing slash so that URL resolution and startsWith work.
  const rootPosixPath = pathToFileURL(rootNativePath).pathname.replace(/\/?$/, "/");
  const rootHref = pathToFileURL(rootNativePath).href.replace(/\/?$/, "/");

  return {
    name: "vite-plugin-local-edit",
    buildStart() {
      if (LOCAL_EDIT_TOKEN) {
        console.info("*** Your local edit token is", `?local-edit=${LOCAL_EDIT_TOKEN}`);
      }
    },
    configureServer(server) {
      if (!LOCAL_EDIT_TOKEN) {
        return;
      }

      server.middlewares.use(async (req, res, next) => {
        try {
          const method = req.method || "GET";
          const url = req.url || "/";
          if (url !== "/@swing/src") {
            next();
            return;
          }

          if (req.headers.authorization !== `Bearer ${LOCAL_EDIT_TOKEN}`) {
            httpSendCode(res, 403);
            return;
          }

          if (method === "GET") {
            const files: Record<string, string> = {};

            async function walk(path: string) {
              for await (const entry of await nodeFs.promises.opendir(path)) {
                if (
                  [
                    ".git",
                    ".gitignore",
                    ".github",
                    "dist",
                    "node_modules",
                    "pnpm-lock.yaml",
                  ].includes(entry.name)
                ) {
                  // TODO: Respect gitignore or otherwise make this configurable.
                  continue;
                }

                const entryNativePath = nodePath.join(entry.parentPath, entry.name);
                const entryPosixPath = pathToFileURL(entryNativePath).pathname;
                const entryPosixRel = nodePath.posix.relative(rootPosixPath, entryPosixPath);
                if (
                  !entryPosixPath.startsWith(rootPosixPath) ||
                  nodePath.posix.isAbsolute(entryPosixRel) ||
                  entryPosixRel == ".." ||
                  entryPosixRel.startsWith("../")
                ) {
                  throw new Error("Assertion failed: Logic error or path traversal");
                }

                if (entry.isDirectory()) {
                  await walk(entryNativePath);
                } else if (entry.isFile()) {
                  // TODO: Support for binary and large files.
                  files[entryPosixRel] = await nodeFs.promises.readFile(entryNativePath, {
                    encoding: "utf-8",
                  });
                }
              }
            }
            await walk(rootNativePath);

            const content = new TextEncoder().encode(JSON.stringify(files));
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Content-Length", content.length);
            res.end(content);
          } else if (method === "PATCH") {
            if (req.headers["content-type"] !== "application/json") {
              httpSendCode(res, 415);
              return;
            }

            const content = Buffer.concat(await Array.fromAsync(req)).toString();
            const files = JSON.parse(content);
            if (!files || typeof files !== "object") {
              httpSendCode(res, 400);
              return;
            }
            for (const [name, data] of Object.entries(files)) {
              if (typeof name !== "string") {
                httpSendCode(res, 400);
                return;
              }
              const entryPosixRel = nodePath.posix.resolve(name);
              const entryHref = new URL(entryPosixRel, rootHref).href;
              const entryNativePath = fileURLToPath(entryHref);
              if (!entryHref.startsWith(rootHref)) {
                throw new Error("Assertion failed: Logic error or path traversal");
              }
              if (entryHref.includes("/.git/")) {
                throw new Error("Safety check failed: Attempted to modify a .git directory");
              }

              if (data == null) {
                await nodeFs.promises.unlink(entryNativePath);
              } else if (typeof data === "string") {
                await nodeFs.promises.writeFile(entryNativePath, data);
              } else {
                httpSendCode(res, 400);
                return;
              }
            }
            httpSendCode(res, 204);
          } else {
            httpSendCode(res, 405);
          }
        } catch (err) {
          console.error(err);
          httpSendCode(res, 500);
        }
      });
    },
  };
}

function httpSendCode(res: nodeHttp.ServerResponse, code: number): void {
  res.statusCode = code;
  if (code === 204) {
    res.end();
    return;
  }

  const content = (nodeHttp.STATUS_CODES[code] || "Internal Server Error") + "\n";
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Length", content.length);
  res.end(content);
}
