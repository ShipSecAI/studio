import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Browser globals for frontend code
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  setInterval: "readonly",
  clearTimeout: "readonly",
  clearInterval: "readonly",
  navigator: "readonly",
  fetch: "readonly",
  btoa: "readonly",
  atob: "readonly",
  React: "readonly",
  process: "readonly",
  NodeJS: "readonly",
  TouchEvent: "readonly",
};

export default [
  {
    ignores: ["dist", "build", "node_modules"],
  },
  js.configs.recommended,
  // Config for TypeScript/TSX files
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: browserGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // Disable react-refresh for now (will enable in later commit)
      "react-refresh/only-export-components": "off",

      // Disable no-undef since TypeScript handles this better
      "no-undef": "off",

      // Disable strict checks for now - will enable gradually
      "no-redeclare": "off",
      "no-import-assign": "off",
      "react/display-name": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-control-regex": "off",
      "no-case-declarations": "off",
      "no-useless-catch": "off",
      "no-console": "off",

      // Loose rules for now - gradually make stricter
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react/no-unescaped-entities": "off",
    },
    settings: {
      react: {
        version: "detect",
      },
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
