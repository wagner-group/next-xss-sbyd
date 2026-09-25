import {AST_NODE_TYPES, type TSESLint, type TSESTree} from "@typescript-eslint/utils";
import {staticString, type RuleContext} from "./utils.js";

/** Checks module boundaries rather than guessing whether a downstream call is safe. */
export function markdownImports(
  context: Pick<RuleContext<string>, "sourceCode">,
  report: (node: TSESTree.Node, source: string | null, imported?: string) => void,
): TSESLint.RuleListener {
  return {
    ImportDeclaration(node) {
      if (node.importKind === "type") return;
      for (const specifier of node.specifiers) {
        if (specifier.type === AST_NODE_TYPES.ImportSpecifier && specifier.importKind === "type") continue;
        const imported = specifier.type === AST_NODE_TYPES.ImportSpecifier
          ? (specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : String(specifier.imported.value))
          : undefined;
        report(specifier, node.source.value, imported);
      }
    },
    ExportNamedDeclaration(node) {
      if (!node.source || node.exportKind === "type") return;
      for (const specifier of node.specifiers) {
        if (specifier.exportKind === "type") continue;
        report(specifier, node.source.value, specifier.local.type === AST_NODE_TYPES.Identifier ? specifier.local.name : String(specifier.local.value));
      }
    },
    ExportAllDeclaration(node) {
      if (node.exportKind !== "type") report(node, node.source.value);
    },
    ImportExpression(node) { report(node, staticString(node.source)); },
    TSImportEqualsDeclaration(node) {
      if (node.importKind !== "type" && node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference)
        report(node, staticString(node.moduleReference.expression));
    },
    CallExpression(node) {
      if (node.callee.type !== AST_NODE_TYPES.Identifier || node.callee.name !== "require") return;
      // A parameter/local called require is not the CommonJS loader.
      for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get("require");
        if (variable && variable.defs.length > 0) return;
      }
      report(node, node.arguments.length === 1 ? staticString(node.arguments[0]) : null);
    },
  };
}
