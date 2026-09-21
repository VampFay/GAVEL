import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — warn (not error) so the build doesn't break, but
    // the lint script surfaces real issues.
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/no-non-null-assertion": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/prefer-as-const": "off",

    // React rules
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "warn",
    "react-hooks/set-state-in-effect": "off", // too noisy for the `useEffect(() => setMounted(true), [])` pattern
    "react/no-unescaped-entities": "warn",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "warn",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    "prefer-const": "error",
    "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-debugger": "error",
    "no-empty": "warn",
    "no-irregular-whitespace": "error",
    "no-case-declarations": "warn",
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "error",
    "no-redeclare": "error",
    // NOTE: `no-undef` is disabled for TS files — TypeScript handles undefined-symbol
    // checking via `noImplicitAny` and module resolution. `no-undef` was flagging
    // `React`, `ResponseInit`, and other DOM/Node globals.
    "no-undef": "off",
    "no-unreachable": "error",
    "no-useless-escape": "warn",
  },
}, {
  files: ["scripts/**/*.js"],
  rules: {
    // Plain-JS utility scripts (changelog, render-og, …) are CommonJS by
    // design — they run under plain `node`, same rationale as the plan-gen
    // ignore below. Keep every other rule; only allow require().
    "@typescript-eslint/no-require-imports": "off",
  },
}, {
  ignores: [
    "node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "skills",
    // Quarantined dead scaffold (unreferenced shadcn/ui components, legacy
    // experiments) — excluded from lint AND tsconfig for the same reason.
    "scripts/orphaned/**",
    // One-shot document generation scripts (CommonJS by design — they run
    // under plain `node`, not the app's ESM toolchain).
    "scripts/plan-gen/**",
  ]
}];

export default eslintConfig;
