import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "e2e-real/live-import-db.cjs",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
