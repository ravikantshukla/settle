import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // CLAUDE.md: all date logic uses clock.now() (real time + demo offset), never the system clock.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/clock.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use clock.now() from @/lib/clock (demo clock), not new Date().",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Use clock.now() from @/lib/clock (demo clock), not Date.now().",
        },
      ],
    },
  },
];

export default eslintConfig;
