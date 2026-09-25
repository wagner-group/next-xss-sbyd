import parser from "@typescript-eslint/parser";
import type {TSESLint} from "@typescript-eslint/utils";
import noDanger from "./rules/no-danger.js";
import noDynamicScriptStyle from "./rules/no-dynamic-script-style.js";
import noHtmlContentType from "./rules/no-html-content-type.js";
import noHtmlTemplateStrings from "./rules/no-html-template-strings.js";
import noRawRenderToString from "./rules/no-raw-render-to-string.js";
import noUnsafeApiSend from "./rules/no-unsafe-api-send.js";
import noUnsafeCastToSafeType from "./rules/no-unsafe-cast-to-safe-type.js";
import noUnsafeHtmlResponse from "./rules/no-unsafe-html-response.js";
import requireDisableJustification from "./rules/require-disable-justification.js";
import requireSafeApiRoute from "./rules/require-safe-api-route.js";
import requireSafeRouteHandler from "./rules/require-safe-route-handler.js";
import requireSafeJsxRuntime from "./rules/require-safe-jsx-runtime.js";
import safeJsxUrlsActive from "./rules/safe-jsx-urls-active.js";
import safeJsxUrlsNavigation from "./rules/safe-jsx-urls-navigation.js";

import requireSafeMarkdown from "./rules/require-safe-markdown.js";
import noUnreviewedMdxExecution from "./rules/no-unreviewed-mdx-execution.js";

const rules = {
  "require-safe-markdown": requireSafeMarkdown,
  "no-unreviewed-mdx-execution": noUnreviewedMdxExecution,
  "no-danger": noDanger,
  "no-unsafe-html-response": noUnsafeHtmlResponse,
  "no-unsafe-api-send": noUnsafeApiSend,
  "require-safe-api-route": requireSafeApiRoute,
  "require-safe-route-handler": requireSafeRouteHandler,
  "no-raw-render-to-string": noRawRenderToString,
  "safe-jsx-urls-active": safeJsxUrlsActive,
  "safe-jsx-urls-navigation": safeJsxUrlsNavigation,
  "no-html-content-type": noHtmlContentType,
  "no-dynamic-script-style": noDynamicScriptStyle,
  "no-unsafe-cast-to-safe-type": noUnsafeCastToSafeType,
  "require-disable-justification": requireDisableJustification,
  "require-safe-jsx-runtime": requireSafeJsxRuntime,
  "no-html-template-strings": noHtmlTemplateStrings,
};

const allowDefaultProjectGlobs = Object.freeze(["*.js", "*.mjs", "*.cjs"] as const);

type Plugin = {
  meta: {name: string; version: string};
  rules: typeof rules;
  configs: Record<string, TSESLint.FlatConfig.Config[]>;
  allowDefaultProjectGlobs: typeof allowDefaultProjectGlobs;
};

const plugin: Plugin = {
  meta: {name: "eslint-plugin-next-xss-sbyd", version: "0.0.0-milestone3"},
  rules,
  configs: {},
  allowDefaultProjectGlobs,
};

plugin.configs.recommended = [
  {
    name: "xss-sbyd/ignores",
    ignores: ["**/.next/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/*.generated.*"],
  },
  {
    name: "xss-sbyd/recommended",
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: {
        projectService: {allowDefaultProject: [...plugin.allowDefaultProjectGlobs]},
        ecmaFeatures: {jsx: true},
      },
    },
    plugins: {"xss-sbyd": plugin},
    rules: {
      "xss-sbyd/no-danger": "error",
      "xss-sbyd/no-unsafe-html-response": "error",
      "xss-sbyd/no-unsafe-api-send": "error",
      "xss-sbyd/require-safe-api-route": "error",
      "xss-sbyd/require-safe-route-handler": "error",
      "xss-sbyd/no-raw-render-to-string": "error",
      "xss-sbyd/safe-jsx-urls-active": "error",
      "xss-sbyd/no-html-content-type": "error",
      "xss-sbyd/no-dynamic-script-style": "error",
      "xss-sbyd/no-unsafe-cast-to-safe-type": "error",
      "xss-sbyd/require-disable-justification": "error",
      "xss-sbyd/require-safe-jsx-runtime": "error",
      "xss-sbyd/no-html-template-strings": "error",
    },
  },
];

const ENFORCEMENT_RULES = new Set(["xss-sbyd/require-disable-justification"]);

plugin.configs.lintMigration = plugin.configs.recommended.map((config) => {
  if (!config.rules) return config;
  return {
    ...config,
    name: "xss-sbyd/lint-migration",
    rules: Object.fromEntries(Object.entries(config.rules).map(([name, setting]) => {
      if (setting === "off" || setting === 0 || ENFORCEMENT_RULES.has(name)) return [name, setting];
      return [name, Array.isArray(setting) ? ["warn", ...setting.slice(1)] : "warn"];
    })),
  };
});

for (const [name, severity] of [["markdown", "error"], ["markdownMigration", "warn"]] as const) {
  plugin.configs[name] = [{
    name: `xss-sbyd/${name}`,
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    languageOptions: {parser, parserOptions: {ecmaFeatures: {jsx: true}}},
    plugins: {"xss-sbyd": plugin},
    rules: {
      "xss-sbyd/require-safe-markdown": severity,
      "xss-sbyd/no-unreviewed-mdx-execution": severity,
    },
  }];
}

export {allowDefaultProjectGlobs, rules};
export default plugin;
