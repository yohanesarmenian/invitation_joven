import js from "@eslint/js";
import globals from "globals";
export default [
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.es2024 } },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];
