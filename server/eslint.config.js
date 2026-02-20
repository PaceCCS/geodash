import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../routes/*"],
              message: "Route files must not import from other route files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/routes/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../routes/*"],
              message: "Route files must not import from other route files.",
            },
            {
              group: ["../../core/*"],
              message:
                "Route files must import from services/ or schemas/, not directly from core modules.",
            },
          ],
        },
      ],
    },
  },
];
