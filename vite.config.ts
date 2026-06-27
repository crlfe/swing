import { defineConfig } from "vite";

import packageJson from "./package.json" with { type: "json" };
import localEditPlugin from "./vite-plugin-local-edit";

export default defineConfig({
  base: "",
  plugins: [localEditPlugin()],
  build: {
    rolldownOptions: {
      // Externalize all runtime dependencies to keep our builds small.
      external: Object.keys(packageJson.dependencies),
      output: {
        assetFileNames: "a/[hash].[ext]",
        chunkFileNames: "a/[hash].js",
        entryFileNames: "a/[hash].js",

        // Load all runtime dependencies from the esm.sh CDN.
        paths: Object.fromEntries(
          Object.entries(packageJson.dependencies).map(([name, version]) => [
            name,
            `https://esm.sh/${name}@${version.replace(/^\^/, "")}`,
          ]),
        ),
      },
    },
  },
});
