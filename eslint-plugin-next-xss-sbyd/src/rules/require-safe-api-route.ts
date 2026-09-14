import ts from "typescript";
import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {createRule, normalizedFilename, requireTypeServices, unwrapExpression} from "../utils.js";

export default createRule({
  name: "require-safe-api-route",
  meta: {type: "problem", docs: {description: "Require withSafeApiRoute around Pages API default exports"}, schema: [], messages: {
    wrapper: "Wrap the Pages API default handler with withSafeApiRoute from next-xss-sbyd/enforce, including when composing other handler wrappers.",
  }},
  defaultOptions: [],
  create(context) {
    if (!/\/pages\/api\/.*\.[cm]?[jt]sx?$/u.test(normalizedFilename(context))) return {};
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();

    function isWrapper(expression: TSESTree.Expression): boolean {
      const node = services.esTreeNodeToTSNodeMap.get(unwrapExpression(expression));
      let symbol = ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ?
        checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), node.argumentExpression.text) :
        checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      return symbol?.getName() === "withSafeApiRoute" && symbol.declarations?.some((declaration) =>
        /\/(?:node_modules\/next-xss-sbyd\/(?:dist\/)?|packages\/next-xss-sbyd\/(?:src|dist)\/)enforce(?:\.d)?\.[cm]?[jt]s$/u.test(
          declaration.getSourceFile().fileName.replaceAll("\\", "/"),
        )) === true;
    }

    function wrapped(expression: TSESTree.Node, seen = new Set<TSESTree.Node>()): boolean {
      if (seen.has(expression)) return false;
      seen.add(expression);
      if (expression.type === AST_NODE_TYPES.Identifier) {
        let scope = context.sourceCode.getScope(expression);
        while (scope) {
          const variable = scope.set.get(expression.name);
          if (variable) {
            if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return false;
            const definition = variable.defs[0];
            return definition?.type === "Variable" && definition.parent?.kind === "const" && definition.node.init != null && wrapped(definition.node.init, seen);
          }
          if (!scope.upper) break;
          scope = scope.upper;
        }
        return false;
      }
      if (expression.type === AST_NODE_TYPES.TSAsExpression || expression.type === AST_NODE_TYPES.TSSatisfiesExpression || expression.type === AST_NODE_TYPES.TSNonNullExpression) return wrapped(expression.expression, seen);
      if (expression.type !== AST_NODE_TYPES.CallExpression) return false;
      if (isWrapper(expression.callee)) return expression.arguments.length > 0;
      return expression.arguments.some((argument) => argument.type !== AST_NODE_TYPES.SpreadElement && wrapped(argument, seen));
    }

    return {
      "ExportDefaultDeclaration:exit"(node: TSESTree.ExportDefaultDeclaration) {
        if (!wrapped(node.declaration)) context.report({node, messageId: "wrapper"});
      },
      ExportNamedDeclaration(node) {
        for (const specifier of node.specifiers) {
          const exported = specifier.exported.type === AST_NODE_TYPES.Identifier ? specifier.exported.name : specifier.exported.value;
          if (exported === "default" && (node.source || !wrapped(specifier.local))) context.report({node: specifier, messageId: "wrapper"});
        }
      },
    };
  },
});
