import {createRule, dangerousScheme, jsxExpression, staticString} from "../utils.js";
import {componentImports, normalizedElement, recordComponentImport, URL_RULE_MESSAGES} from "./url-utils.js";

const PASSIVE_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ["href"], area: ["href"], audio: ["src"], button: ["formAction"], form: ["action"],
  img: ["src", "srcSet"], input: ["src", "formAction"], source: ["src", "srcSet"],
  track: ["src"], video: ["src", "poster"], "next/form": ["action"],
  "next/image": ["src", "srcSet"], "next/link": ["href", "as"],
};

export default createRule({
  name: "safe-jsx-urls-navigation",
  meta: {type: "problem", docs: {description: "Reject dangerous literals in runtime-validated passive URL sinks"}, schema: [], messages: {
    ...URL_RULE_MESSAGES,
  }},
  defaultOptions: [],
  create(context) {
    const imports = componentImports();
    return {
      ImportDeclaration(node) { recordComponentImport(imports, node); },
      JSXOpeningElement(node) {
        const element = normalizedElement(node, imports);
        if (!element) return;
        for (const name of PASSIVE_ATTRIBUTES[element] ?? []) {
          const attribute = node.attributes.find((candidate): candidate is Extract<typeof candidate, {type: "JSXAttribute"}> => candidate.type === "JSXAttribute" && candidate.name.name === name);
          const value = attribute ? staticString(jsxExpression(attribute)) : null;
          if (value !== null && dangerousScheme(value)) context.report({node: attribute!, messageId: "dangerousLiteral"});
        }
      },
    };
  },
});
