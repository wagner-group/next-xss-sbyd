import {AST_NODE_TYPES} from "@typescript-eslint/utils";
import {createRule, jsxAttribute, jsxElementName, jsxSpreadPropertyTypes, staticString} from "../utils.js";

export default createRule({
  name: "no-dynamic-script-style",
  meta: {type: "problem", docs: {description: "Disallow dynamic inline script and style content"}, schema: [], messages: {
    dynamic: "Dynamic inline {{kind}} content is unsafe. Use {{replacement}}.",
    bootstrap: "bootstrapScriptContent must be a literal; prefer static bundled code.",
  }},
  defaultOptions: [],
  create(context) {
    const scriptComponents = new Set<string>();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "next/script") return;
        for (const specifier of node.specifiers) scriptComponents.add(specifier.local.name);
      },
      JSXElement(node) {
        const name = jsxElementName(node.openingElement);
        const lower = name?.toLowerCase();
        const kind = scriptComponents.has(name ?? "") ? "script" : lower;
        if (kind !== "script" && kind !== "style") return;
        const raw = jsxAttribute(node.openingElement, "dangerouslySetInnerHTML");
        if (raw) context.report({node: raw, messageId: "dynamic", data: {kind, replacement: kind === "script" ? "<SafeJsonScript> or <SafeScriptBlock>" : "<SafeStyleBlock>"}});
        for (const name of ["children", "dangerouslySetInnerHTML"]) {
          for (const spread of jsxSpreadPropertyTypes(context, node.openingElement, name)) {
            if (name === "children" && spread.type.isStringLiteral()) continue;
            context.report({node: spread.attribute, messageId: "dynamic", data: {kind, replacement: kind === "script" ? "<SafeJsonScript> or <SafeScriptBlock>" : "<SafeStyleBlock>"}});
          }
        }
        for (const child of node.children) {
          if (child.type !== AST_NODE_TYPES.JSXExpressionContainer || child.expression.type === AST_NODE_TYPES.JSXEmptyExpression) continue;
          if (staticString(child.expression) === null) context.report({node: child, messageId: "dynamic", data: {kind, replacement: kind === "script" ? "<SafeJsonScript> or <SafeScriptBlock>" : "<SafeStyleBlock>"}});
        }
      },
      Property(node) {
        const key = node.key;
        const name = key.type === AST_NODE_TYPES.Identifier ? key.name : key.type === AST_NODE_TYPES.Literal ? String(key.value) : "";
        if (name === "bootstrapScriptContent" && staticString(node.value) === null) context.report({node, messageId: "bootstrap"});
      },
    };
  },
});
