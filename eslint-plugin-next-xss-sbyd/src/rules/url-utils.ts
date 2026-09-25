import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {dangerousScheme, jsxAttribute, jsxElementName, jsxExpression, jsxSpreadPropertyTypes, staticString, typeAt, typeContainsSafeBrand, type RuleContext} from "../utils.js";

export interface ComponentImports {
  form: Set<string>;
  image: Set<string>;
  link: Set<string>;
  script: Set<string>;
}

export function componentImports(): ComponentImports {
  return {form: new Set(), image: new Set(), link: new Set(), script: new Set()};
}

export function recordComponentImport(imports: ComponentImports, node: TSESTree.ImportDeclaration): void {
  const kind = node.source.value === "next/link" ? "link" : node.source.value === "next/image" ? "image" :
    node.source.value === "next/form" ? "form" : node.source.value === "next/script" ? "script" : null;
  if (!kind) return;
  for (const specifier of node.specifiers) if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier || specifier.type === AST_NODE_TYPES.ImportSpecifier) imports[kind].add(specifier.local.name);
}

export function normalizedElement(node: TSESTree.JSXOpeningElement, imports: ComponentImports): string | null {
  const name = jsxElementName(node);
  if (!name) return null;
  if (imports.link.has(name)) return "next/link";
  if (imports.image.has(name)) return "next/image";
  if (imports.form.has(name)) return "next/form";
  if (imports.script.has(name)) return "next/script";
  return /^[a-z]/u.test(name) ? name.toLowerCase() : name;
}

export function checkUrlAttribute<Message extends string>(
  context: RuleContext<Message, readonly unknown[]>,
  opening: TSESTree.JSXOpeningElement,
  attributeName: string,
  requiredBrands: readonly string[],
  messageId: Message,
  reportDangerousLiteral = true,
  allowCallable = false,
  allowSafeLiteral = true,
): void {
  const attribute = jsxAttribute(opening, attributeName);
  const expression = attribute ? jsxExpression(attribute) : null;
  if (attribute && expression) {
    const literal = staticString(expression);
    if (literal !== null && dangerousScheme(literal)) {
      if (reportDangerousLiteral) context.report({node: attribute, messageId: "dangerousLiteral" as Message});
    } else if (literal !== null) {
      if (!allowSafeLiteral) context.report({node: attribute, messageId});
    } else {
      const valueType = typeAt(context, expression);
      if (!(allowCallable && valueType.getCallSignatures().length > 0) && !typeContainsSafeBrand(valueType, requiredBrands)) {
        context.report({node: attribute, messageId});
      }
    }
  }
  for (const spread of jsxSpreadPropertyTypes(context, opening, attributeName)) {
    if (allowCallable && spread.type.getCallSignatures().length > 0) continue;
    if (allowSafeLiteral && spread.type.isStringLiteral() && !dangerousScheme(spread.type.value)) continue;
    if (!typeContainsSafeBrand(spread.type, requiredBrands)) context.report({node: spread.attribute, messageId});
  }
}

export const URL_RULE_MESSAGES = {
  dangerousLiteral: "Dangerous or executable URL scheme in JSX. Use validateUrl for passive URLs or trustedScriptUrl for active content.",
} as const;
