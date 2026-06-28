import { defineConfig } from "oxlint";

export default defineConfig({
  rules: {
    "import/extensions": ["error", "always"],
    "typescript/consistent-type-imports": "error",
  },
});
