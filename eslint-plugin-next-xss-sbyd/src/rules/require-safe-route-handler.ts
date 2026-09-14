import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {createRule, normalizedFilename, unwrapExpression} from "../utils.js";

const methods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);
const modules = new Set(["next-xss-sbyd/enforce", "next-xss-sbyd/route-handler"]);

export default createRule({
  name: "require-safe-route-handler",
  meta: {type: "problem", docs: {description: "Require explicit wrappers on App Router HTTP exports"}, fixable: "code", schema: [], messages: {
    wrapper: "Export each HTTP method as export const GET = withSafeRouteHandler(handler), importing withSafeRouteHandler from next-xss-sbyd/route-handler. Split destructured handlers into one wrapped export per method; wrap re-exported handlers in this module.",
  }},
  defaultOptions: [],
  create(context) {
    if (!/\/app\/(?:.*\/)?route\.[cm]?[jt]sx?$/u.test(normalizedFilename(context))) return {};
    const source = context.sourceCode;

    function isWrapper(node: TSESTree.Expression): boolean {
      const callee = unwrapExpression(node);
      if (callee.type !== AST_NODE_TYPES.Identifier) return false;
      let scope = source.getScope(callee);
      while (scope) {
        const variable = scope.set.get(callee.name);
        if (variable) {
          const definition = variable.defs[0];
          if (definition?.type !== "ImportBinding" || definition.node.type !== AST_NODE_TYPES.ImportSpecifier || definition.parent.type !== AST_NODE_TYPES.ImportDeclaration) return false;
          const imported = definition.node.imported;
          return definition.parent.importKind !== "type" && definition.node.importKind !== "type" &&
            modules.has(definition.parent.source.value) &&
            (imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value) === "withSafeRouteHandler";
        }
        if (!scope.upper) break;
        scope = scope.upper;
      }
      return false;
    }

    function wrapped(node: TSESTree.Expression): boolean {
      const expression = unwrapExpression(node);
      return expression.type === AST_NODE_TYPES.CallExpression && isWrapper(expression.callee) &&
        expression.arguments.length >= 1 && expression.arguments[0]?.type !== AST_NODE_TYPES.SpreadElement;
    }

    function wrappedLocal(node: TSESTree.Identifier): boolean {
      let scope = source.getScope(node);
      while (scope) {
        const variable = scope.set.get(node.name);
        if (variable) {
          const definition = variable.defs[0];
          return definition?.type === "Variable" && definition.parent.kind === "const" &&
            definition.node.id.type === AST_NODE_TYPES.Identifier &&
            definition.node.init !== null && wrapped(definition.node.init);
        }
        if (!scope.upper) break;
        scope = scope.upper;
      }
      return false;
    }

    function containsMethod(node: TSESTree.Node): boolean {
      if (node.type === AST_NODE_TYPES.Identifier) return methods.has(node.name);
      if (node.type === AST_NODE_TYPES.ObjectPattern) return node.properties.some((property) => containsMethod(property.type === AST_NODE_TYPES.RestElement ? property.argument : property.value));
      if (node.type === AST_NODE_TYPES.ArrayPattern) return node.elements.some((element) => element != null && containsMethod(element));
      if (node.type === AST_NODE_TYPES.AssignmentPattern) return containsMethod(node.left);
      if (node.type === AST_NODE_TYPES.RestElement) return containsMethod(node.argument);
      return false;
    }

    return {
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type") context.report({node, messageId: "wrapper"});
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.exportKind === "type") continue;
          const name = specifier.exported.type === AST_NODE_TYPES.Identifier ? specifier.exported.name : specifier.exported.value;
          if (methods.has(name) && !(node.source === null && specifier.local.type === AST_NODE_TYPES.Identifier && wrappedLocal(specifier.local))) context.report({node: specifier, messageId: "wrapper"});
        }
        const declaration = node.declaration;
        if (!declaration) return;
        const functionExport = declaration.type === AST_NODE_TYPES.FunctionDeclaration && declaration.id && methods.has(declaration.id.name);
        if (declaration.type !== AST_NODE_TYPES.VariableDeclaration && !functionExport) {
          if ("id" in declaration && declaration.id?.type === AST_NODE_TYPES.Identifier && methods.has(declaration.id.name)) context.report({node: declaration, messageId: "wrapper"});
          return;
        }
        const invalid = declaration.type === AST_NODE_TYPES.VariableDeclaration
          ? declaration.declarations.filter((entry) => containsMethod(entry.id) &&
            !(declaration.kind === "const" && entry.id.type === AST_NODE_TYPES.Identifier && entry.init && wrapped(entry.init)))
          : [declaration];
        for (const entry of invalid) context.report({node: entry, messageId: "wrapper", fix(fixer) {
          if (declaration.type === AST_NODE_TYPES.VariableDeclaration &&
            (declaration.kind !== "const" || declaration.declarations.length !== 1 || entry.type !== AST_NODE_TYPES.VariableDeclarator || entry.id.type !== AST_NODE_TYPES.Identifier || !entry.init)) return null;
          if (declaration.type === AST_NODE_TYPES.FunctionDeclaration) {
            const overloaded = source.ast.body.some((statement) => {
              const candidate = statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;
              return candidate?.type === AST_NODE_TYPES.TSDeclareFunction && candidate.id?.name === declaration.id?.name;
            });
            if (overloaded) return null;
            // Moving a function declaration to a const must not invalidate earlier calls.
            const variable = source.getDeclaredVariables(declaration)[0];
            if (!declaration.body || variable?.references.some((reference) => reference.identifier.range[0] < node.range[0])) return null;
          }
          let wrapperName: string | undefined;
          for (const statement of source.ast.body) {
            if (statement.type !== AST_NODE_TYPES.ImportDeclaration) continue;
            for (const specifier of statement.specifiers) if (isWrapper(specifier.local)) wrapperName = specifier.local.name;
          }
          const fixes = [];
          if (!wrapperName) {
            wrapperName = "withSafeRouteHandler";
            const names = new Set(source.scopeManager?.scopes.flatMap((scope) => scope.variables.map((variable) => variable.name)));
            while (names.has(wrapperName)) wrapperName = `_${wrapperName}`;
            const importText = `import {withSafeRouteHandler${wrapperName === "withSafeRouteHandler" ? "" : ` as ${wrapperName}`}} from "next-xss-sbyd/route-handler";\n`;
            const statements = source.ast.body;
            const first = statements.find((statement) => statement.type !== AST_NODE_TYPES.ExpressionStatement || !statement.directive);
            fixes.push(first ? fixer.insertTextBefore(first, importText) : fixer.insertTextAfterRange([0, source.text.length], `\n${importText}`));
          }
          if (declaration.type === AST_NODE_TYPES.FunctionDeclaration) {
            fixes.push(fixer.replaceText(node, `export const ${declaration.id!.name} = ${wrapperName}(${source.getText(declaration)});`));
          } else if (entry.type === AST_NODE_TYPES.VariableDeclarator && entry.init) {
            fixes.push(fixer.replaceText(entry.init, `${wrapperName}((${source.getText(entry.init)}))`));
          }
          return fixes;
        }});
      },
    };
  },
});
