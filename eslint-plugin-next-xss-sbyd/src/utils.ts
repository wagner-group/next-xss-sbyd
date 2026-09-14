import ts from "typescript";
import {dirname, join} from "node:path";
import {AST_NODE_TYPES, ESLintUtils, type TSESLint, type TSESTree} from "@typescript-eslint/utils";

export type RuleContext<MessageIds extends string, Options extends readonly unknown[] = []> =
  TSESLint.RuleContext<MessageIds, Options>;

export const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/davidwagner/next-xss-sbyd/blob/main/eslint-plugin-next-xss-sbyd/rules.md#${name}`,
);

export interface ReactFactoryBindings {
  createElement: Set<string>;
  cloneElement: Set<string>;
  namespaces: Set<string>;
}

/** Creates binding state shared by rules that recognize raw React element factories. */
export function reactFactoryBindings(): ReactFactoryBindings {
  return {createElement: new Set(), cloneElement: new Set(), namespaces: new Set()};
}

function importSpecifierName(specifier: TSESTree.ImportClause): string | null {
  if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) return null;
  return specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : String(specifier.imported.value);
}

function isReactRequire(node: TSESTree.Node | null | undefined): boolean {
  return node?.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === "require" &&
    node.arguments.length === 1 && node.arguments[0]?.type === AST_NODE_TYPES.Literal &&
    node.arguments[0].value === "react";
}

function recordFactoryName(bindings: ReactFactoryBindings, imported: string, local: string): void {
  if (imported === "createElement") bindings.createElement.add(local);
  if (imported === "cloneElement") bindings.cloneElement.add(local);
}

/** Records ESM imports that bind React namespaces or raw element factories. */
export function recordReactImport(bindings: ReactFactoryBindings, node: TSESTree.ImportDeclaration): void {
  if (node.source.value !== "react") return;
  for (const specifier of node.specifiers) {
    if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier || specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
      bindings.namespaces.add(specifier.local.name);
    } else {
      const imported = importSpecifierName(specifier);
      if (imported) recordFactoryName(bindings, imported, specifier.local.name);
    }
  }
}

/** Records simple aliases and CommonJS destructuring of React factories. */
export function recordReactVariable(bindings: ReactFactoryBindings, node: TSESTree.VariableDeclarator): void {
  const init = node.init && unwrapExpression(node.init);
  if (!init) return;
  if (node.id.type === AST_NODE_TYPES.Identifier) {
    if (isReactRequire(init)) bindings.namespaces.add(node.id.name);
    if (init.type === AST_NODE_TYPES.Identifier) {
      if (bindings.namespaces.has(init.name)) bindings.namespaces.add(node.id.name);
      if (bindings.createElement.has(init.name)) bindings.createElement.add(node.id.name);
      if (bindings.cloneElement.has(init.name)) bindings.cloneElement.add(node.id.name);
    }
    if (init.type === AST_NODE_TYPES.MemberExpression && init.object.type === AST_NODE_TYPES.Identifier && bindings.namespaces.has(init.object.name)) {
      const member = staticPropertyName(init);
      if (member) recordFactoryName(bindings, member, node.id.name);
    }
    return;
  }
  if (node.id.type !== AST_NODE_TYPES.ObjectPattern) return;
  const sourceIsReact = isReactRequire(init) || (init.type === AST_NODE_TYPES.Identifier && bindings.namespaces.has(init.name));
  if (!sourceIsReact) return;
  for (const property of node.id.properties) {
    if (property.type !== AST_NODE_TYPES.Property || property.value.type !== AST_NODE_TYPES.Identifier) continue;
    const imported = property.key.type === AST_NODE_TYPES.Identifier ? property.key.name :
      property.key.type === AST_NODE_TYPES.Literal ? String(property.key.value) : null;
    if (!imported) continue;
    recordFactoryName(bindings, imported, property.value.name);
  }
}

/** Records TypeScript's `import React = require("react")` namespace form. */
export function recordReactImportEquals(bindings: ReactFactoryBindings, node: TSESTree.TSImportEqualsDeclaration): void {
  const reference = node.moduleReference;
  if (reference.type === AST_NODE_TYPES.TSExternalModuleReference && reference.expression.value === "react") {
    bindings.namespaces.add(node.id.name);
  }
}

/** Returns whether a callee resolves through tracked bindings to a raw React factory. */
export function rawReactFactory(bindings: ReactFactoryBindings, node: TSESTree.Expression): "createElement" | "cloneElement" | null {
  const callee = unwrapExpression(node);
  if (callee.type === AST_NODE_TYPES.Identifier) {
    if (bindings.createElement.has(callee.name)) return "createElement";
    if (bindings.cloneElement.has(callee.name)) return "cloneElement";
    return null;
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.object.type !== AST_NODE_TYPES.Identifier ||
      !bindings.namespaces.has(callee.object.name)) return null;
  const member = staticPropertyName(callee);
  return member === "createElement" || member === "cloneElement" ? member : null;
}

export function staticPropertyName(
  node: TSESTree.MemberExpression | TSESTree.JSXAttribute,
): string | null {
  const property = node.type === AST_NODE_TYPES.JSXAttribute ? node.name : node.property;
  if (property.type === AST_NODE_TYPES.Identifier || property.type === AST_NODE_TYPES.JSXIdentifier) {
    return property.name;
  }
  if (property.type === AST_NODE_TYPES.JSXNamespacedName) {
    return `${property.namespace.name}:${property.name.name}`;
  }
  if (property.type === AST_NODE_TYPES.Literal && typeof property.value === "string") {
    return property.value;
  }
  return null;
}

export function jsxElementName(node: TSESTree.JSXOpeningElement): string | null {
  if (node.name.type === AST_NODE_TYPES.JSXIdentifier) return node.name.name;
  if (node.name.type === AST_NODE_TYPES.JSXMemberExpression) return node.name.property.name;
  return null;
}

export function jsxAttribute(
  node: TSESTree.JSXOpeningElement,
  name: string,
): TSESTree.JSXAttribute | undefined {
  return node.attributes.find(
    (attribute): attribute is TSESTree.JSXAttribute =>
      attribute.type === AST_NODE_TYPES.JSXAttribute &&
      staticPropertyName(attribute)?.toLowerCase() === name.toLowerCase(),
  );
}

export function jsxExpression(attribute: TSESTree.JSXAttribute): TSESTree.Expression | null {
  const value = attribute.value;
  if (!value) return null;
  if (value.type === AST_NODE_TYPES.Literal) return value;
  if (value.type === AST_NODE_TYPES.JSXExpressionContainer &&
      value.expression.type !== AST_NODE_TYPES.JSXEmptyExpression) return value.expression;
  return null;
}

export function jsxSpreadPropertyTypes<MessageIds extends string, Options extends readonly unknown[]>(
  context: RuleContext<MessageIds, Options>,
  node: TSESTree.JSXOpeningElement,
  name: string,
): Array<{attribute: TSESTree.JSXSpreadAttribute; type: ts.Type}> {
  const checker = requireTypeServices(context).program.getTypeChecker();
  const matches: Array<{attribute: TSESTree.JSXSpreadAttribute; type: ts.Type}> = [];
  node.attributes.forEach((attribute, index) => {
    if (attribute.type !== AST_NODE_TYPES.JSXSpreadAttribute) return;
    const overridden = node.attributes.slice(index + 1).some((later) =>
      later.type === AST_NODE_TYPES.JSXAttribute && staticPropertyName(later)?.toLowerCase() === name.toLowerCase());
    if (overridden) return;
    const spreadType = typeAt(context, attribute.argument);
    if ((spreadType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      matches.push({attribute, type: spreadType});
      return;
    }
    const property = spreadType.getProperties().find((candidate) => candidate.getName().toLowerCase() === name.toLowerCase());
    const declaration = property?.valueDeclaration ?? property?.declarations?.[0];
    if (property && declaration) matches.push({attribute, type: checker.getTypeOfSymbolAtLocation(property, declaration)});
  });
  return matches;
}

/** Return every possible string literal value, or null for a nonliteral type. */
export function literalStrings(type: ts.Type): string[] | null {
  const alternatives = type.isUnion() ? type.types : [type];
  const values: string[] = [];
  for (const alternative of alternatives) {
    if (!alternative.isStringLiteral()) return null;
    values.push(alternative.value);
  }
  return values;
}

export function staticString(node: TSESTree.Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === "string") return node.value;
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  }
  return null;
}

export function unwrapExpression(node: TSESTree.Expression): TSESTree.Expression {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.ChainExpression
  ) current = current.expression;
  return current;
}

export function calleeName(node: TSESTree.Expression): string | null {
  const expression = unwrapExpression(node);
  if (expression.type === AST_NODE_TYPES.Identifier) return expression.name;
  if (expression.type === AST_NODE_TYPES.MemberExpression) return staticPropertyName(expression);
  return null;
}

export function typeName(node: TSESTree.TypeNode): string | null {
  if (node.type === AST_NODE_TYPES.TSTypeReference) {
    const name = node.typeName;
    if (name.type === AST_NODE_TYPES.Identifier) return name.name;
    return name.type === AST_NODE_TYPES.TSQualifiedName ? name.right.name : null;
  }
  return null;
}

export function requireTypeServices<MessageIds extends string, Options extends readonly unknown[]>(
  context: RuleContext<MessageIds, Options>,
) {
  return ESLintUtils.getParserServices(context);
}

export function typeAt<MessageIds extends string, Options extends readonly unknown[]>(
  context: RuleContext<MessageIds, Options>,
  node: TSESTree.Node,
): ts.Type {
  return requireTypeServices(context).getTypeAtLocation(node);
}

const SAFE_BRAND_MARKERS: Readonly<Record<string, string>> = {
  CspNonce: "cspNonceBrand",
  PassiveResponse: "passiveResponseBrand",
  SafeFormActionUrl: "formActionUrlBrand",
  SafeHtml: "privateDoNotAccessOrElseWrappedHtml",
  SafeNavigationUrl: "navigationUrlBrand",
  SafeNodeStream: "safeNodeStreamBrand",
  SafeResourceUrl: "resourceUrlBrand",
  SafeScript: "privateDoNotAccessOrElseWrappedScript",
  SafeStream: "safeStreamBrand",
  SafeStyleSheet: "privateDoNotAccessOrElseWrappedStyleSheet",
  TrustedResourceUrl: "privateDoNotAccessOrElseWrappedResourceUrl",
};

const safePackageSources = new WeakMap<ts.SourceFile, boolean>();

/** Recognizes the owning package even when a workspace uses a different directory name. */
function isSafePackageSource(source: ts.SourceFile): boolean {
  const cached = safePackageSources.get(source);
  if (cached !== undefined) return cached;
  let directory = dirname(source.fileName);
  let safe = false;
  for (;;) {
    const manifest = join(directory, "package.json");
    if (ts.sys.fileExists(manifest)) {
      try {
        const name = (JSON.parse(ts.sys.readFile(manifest) ?? "") as {name?: unknown}).name;
        if (name !== undefined) {
          safe = name === "next-xss-sbyd" || name === "safevalues";
          break;
        }
        // Some packages add name-less manifests only to select ESM or CommonJS.
      } catch {
        // A malformed nearest manifest cannot establish package ownership.
        break;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  safePackageSources.set(source, safe);
  return safe;
}

function hasSafePackageDeclaration(symbol: ts.Symbol): boolean {
  return symbol.declarations?.some((declaration) => isSafePackageSource(declaration.getSourceFile())) === true;
}

/** Recognizes package-owned safe types and their preserved brand properties. */
export function typeContainsSafeBrand(type: ts.Type, names: readonly string[]): boolean {
  for (const symbol of [type.aliasSymbol, type.getSymbol()]) {
    if (symbol && names.includes(symbol.getName()) && hasSafePackageDeclaration(symbol)) return true;
  }
  for (const property of type.getProperties()) {
    if (!names.some((name) => property.getName().includes(SAFE_BRAND_MARKERS[name] ?? "\0"))) continue;
    if ((property.flags & ts.SymbolFlags.Optional) !== 0) continue;
    if (hasSafePackageDeclaration(property)) return true;
  }
  return type.isUnionOrIntersection() && type.types.some((part) => typeContainsSafeBrand(part, names));
}

export function isAnyType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Any) !== 0;
}

export function isStringLike(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.some(isStringLike);
  return (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral | ts.TypeFlags.TemplateLiteral)) !== 0;
}

export function isNullish(type: ts.Type): boolean {
  if (type.isUnion()) return type.types.every(isNullish);
  return (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
}

export function dangerousScheme(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  return /^(?:javascript|vbscript|data):/.test(normalized);
}

export function isHtmlMediaType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "text/html" || mediaType === "application/xhtml+xml" || mediaType?.endsWith("+html") === true;
}

export function objectProperty(
  node: TSESTree.ObjectExpression,
  name: string,
): TSESTree.Property | undefined {
  return node.properties.find(
    (property): property is TSESTree.Property =>
      property.type === AST_NODE_TYPES.Property &&
      ((property.key.type === AST_NODE_TYPES.Identifier && property.key.name.toLowerCase() === name.toLowerCase()) ||
       (property.key.type === AST_NODE_TYPES.Literal && String(property.key.value).toLowerCase() === name.toLowerCase())),
  );
}

export function normalizedFilename(context: RuleContext<string, readonly unknown[]>): string {
  return context.filename.replaceAll("\\", "/");
}
