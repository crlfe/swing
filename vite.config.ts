/// <reference types="vitest/config" />

import NodeFS from "node:fs";

import { defineConfig } from "vite";

import pluginDevFs from "./vite-plugin-dev-fs.ts";

export default defineConfig({
  plugins: [pluginDevFs()],
  base: "",
  build: {
    rolldownOptions: {
      output: {
        assetFileNames: "a/[hash].[ext]",
        chunkFileNames: "a/[hash].js",
        entryFileNames: "a/[hash].js",
      },
    },
  },
  define: {
    "import.meta.vitest": "undefined",
    "import.meta.env.LICENSES": JSON.stringify(
      [
        `# Swing`,
        NodeFS.readFileSync("./LICENSE.txt"),

        `# CodeMirror`,
        NodeFS.readFileSync("./node_modules/codemirror/LICENSE", { encoding: "utf-8" }).replace(
          /\s+$/,
          "\n",
        ),

        `# JSZip`,
        await getJSZipLicense(),
      ].join("\n\n"),
    ),
  },
  server: {
    strictPort: true,
  },
  test: {
    includeSource: ["src/**/*.ts"],
  },
});

async function getJSZipLicense() {
  const text = NodeFS.readFileSync("./node_modules/jszip/LICENSE.markdown", { encoding: "utf-8" });
  const m = /\nThe MIT License\n=+\n\n(.*?)\n\nGPL/s.exec(text);
  if (!m) throw new Error("Failed to get JSZip license");
  return m[1];
}
