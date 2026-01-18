import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

// Node.js globals for worker code
const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  module: "writable",
  require: "readonly",
  exports: "writable",
  global: "readonly",
};

export default [
  {
    ignores: ["dist", "build", "node_modules"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: nodeGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,

      // Disable no-undef since TypeScript handles this better
      "no-undef": "off",

      // Disable strict checks for now - will enable gradually
      "no-redeclare": "off",
      "no-import-assign": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-case-declarations": "off",
      "no-useless-catch": "off",
      "no-console": "off",
      "no-prototype-builtins": "off",
      "no-useless-escape": "off",

      // Loose rules for now - gradually make stricter
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Config for JS files
  {
    files: ["**/*.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
];
