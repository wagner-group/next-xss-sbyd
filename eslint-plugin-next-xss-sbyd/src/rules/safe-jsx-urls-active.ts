import {createRule, jsxAttribute, jsxExpression, jsxSpreadPropertyTypes, staticString, typeAt, typeContainsSafeBrand, type RuleContext} from "../utils.js";
import {checkUrlAttribute, componentImports, normalizedElement, recordComponentImport, URL_RULE_MESSAGES} from "./url-utils.js";

type Message = "active" | "forbidden" | "dangerousLiteral" | "srcdoc";
function checkSrcdoc(context: RuleContext<Message>, node: Parameters<typeof jsxAttribute>[0], name: string): void {
  const attribute = jsxAttribute(node, name);
  const expression = attribute ? jsxExpression(attribute) : null;
  if (attribute && expression && !typeContainsSafeBrand(typeAt(context, expression), ["SafeHtml"])) {
    context.report({node: attribute, messageId: "srcdoc"});
  }
  for (const spread of jsxSpreadPropertyTypes(context, node, name)) {
    if (!typeContainsSafeBrand(spread.type, ["SafeHtml"])) context.report({node: spread.attribute, messageId: "srcdoc"});
  }
}

export default createRule({
  name: "safe-jsx-urls-active",
  meta: {type: "problem", docs: {description: "Require trusted URLs in active-content JSX sinks"}, schema: [], messages: {
    ...URL_RULE_MESSAGES,
    active: "This active-content URL requires TrustedResourceUrl.",
    forbidden: "This URL sink is forbidden because it can rewrite document security behavior.",
    srcdoc: "An iframe srcdoc document requires SafeHtml.",
  }},
  defaultOptions: [],
  create(context) {
    const imports = componentImports();
    return {
      ImportDeclaration(node) { recordComponentImport(imports, node); },
      JSXOpeningElement(node) {
        const element = normalizedElement(node, imports);
        if (!element) return;
        if (element === "base" && jsxAttribute(node, "href")) context.report({node: jsxAttribute(node, "href")!, messageId: "forbidden"});
        if (element === "meta") {
          const equiv = jsxAttribute(node, "http-equiv") ?? jsxAttribute(node, "httpEquiv");
          const value = equiv ? staticString(jsxExpression(equiv)) : null;
          if (value?.toLowerCase() === "refresh") context.report({node, messageId: "forbidden"});
        }
        const activeAttribute = element === "script" || element === "next/script" || element === "iframe" || element === "frame" || element === "embed" ? "src" : element === "object" ? "data" : null;
        if (activeAttribute) checkUrlAttribute(context, node, activeAttribute, ["TrustedResourceUrl"], "active", true, false, false);
        if (element === "iframe" || element === "frame") {
          checkSrcdoc(context, node, "srcDoc");
        }
        if (element === "link") {
          const rel = jsxAttribute(node, "rel");
          const relValue = rel ? staticString(jsxExpression(rel))?.toLowerCase() ?? null : "";
          if (relValue === null || ["stylesheet", "preload", "modulepreload", "import"].includes(relValue)) checkUrlAttribute(context, node, "href", ["TrustedResourceUrl"], "active", true, false, false);
        }
        if (["use", "image", "feimage"].includes(element)) {
          checkUrlAttribute(context, node, "href", ["TrustedResourceUrl"], "active", true, false, false);
          checkUrlAttribute(context, node, "xlink:href", ["TrustedResourceUrl"], "active", true, false, false);
          checkUrlAttribute(context, node, "xlinkHref", ["TrustedResourceUrl"], "active", true, false, false);
        }
      },
    };
  },
});
