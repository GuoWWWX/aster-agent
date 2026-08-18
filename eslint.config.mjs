import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const webRestrictedImports = [
  {
    name: "electron",
    message: "Web code must use AgentClient and cannot import Electron."
  },
  {
    name: "better-sqlite3",
    message: "Web code must not access SQLite."
  },
  {
    name: "@tauri-apps/api",
    message: "Web code must use AgentClient and cannot import Tauri."
  }
];

const webRestrictedPatterns = [
  {
    group: ["node:*"],
    message: "Web code must use AgentClient and cannot import Node.js APIs."
  },
  {
    group: ["@tauri-apps/api/*"],
    message: "Web code must use AgentClient and cannot import Tauri."
  }
];

const desktopModelRestrictedPatterns = [
  {
    group: ["../storage/*", "../agent/*", "../tools/*", "../tasks/*"],
    message: "Model adapters must depend on neutral contracts, not runtime or storage modules."
  }
];

const desktopStorageRestrictedPatterns = [
  {
    group: ["../agent/*", "../tools/*", "../tasks/*"],
    message: "Storage must not depend on Agent Runtime or tool orchestration."
  }
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "import/no-cycle": "error"
    }
  },
  {
    files: ["apps/desktop/src/main/model/**/*.{ts,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: desktopModelRestrictedPatterns }]
    }
  },
  {
    files: ["apps/desktop/src/main/storage/**/*.{ts,mts,cts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: desktopStorageRestrictedPatterns }]
    }
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: webRestrictedImports,
          patterns: webRestrictedPatterns
        }
      ]
    }
  }
);
