import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import ts from "typescript";
import {createRule, isAnyType, requireTypeServices, typeAt, typeContainsSafeBrand} from "../utils.js";

const SAFE_TYPES = ["SafeHtml", "SafeNavigationUrl", "SafeResourceUrl", "SafeFormActionUrl", "TrustedResourceUrl", "SafeScript", "SafeStyleSheet", "SafeStream", "SafeNodeStream", "CspNonce", "PassiveResponse"];
export default createRule({
  name: "no-unsafe-cast-to-safe-type",
  meta: {type: "problem", docs: {description: "Disallow casts and any values that bypass safe-value brands"}, schema: [], messages: {
    cast: "Do not cast to {{name}}. Use its safe builder or a reviewed restricted conversion.",
    any: "An any-typed value bypasses the safe sink's branded parameter. Validate and construct the required safe value first.",
  }},
  defaultOptions: [],
  create(context) {
    const services = requireTypeServices(context);
    const checker = services.program.getTypeChecker();
    const safeComponents = new Map<string, string>();
    function inspectAnyFlow(value: TSESTree.Expression, target: TSESTree.Node): void {
      if (isAnyType(typeAt(context, value)) && typeContainsSafeBrand(typeAt(context, target), SAFE_TYPES)) {
        context.report({node: value, messageId: "any"});
      }
    }
    function inspectContextualAny(value: TSESTree.Expression): void {
      const contextual = checker.getContextualType(services.esTreeNodeToTSNodeMap.get(value) as ts.Expression);
      if (contextual && isAnyType(typeAt(context, value)) && typeContainsSafeBrand(contextual, SAFE_TYPES)) {
        context.report({node: value, messageId: "any"});
      }
    }
    function inspectAssertion(node: TSESTree.TSAsExpression | TSESTree.TSTypeAssertion | TSESTree.TSSatisfiesExpression): void {
      const asserted = typeAt(context, node.typeAnnotation);
      const name = SAFE_TYPES.find((safeType) => typeContainsSafeBrand(asserted, [safeType]));
      const source = typeAt(context, node.expression);
      const alternatives = source.isUnion() ? source.types : [source];
      if (name && !alternatives.every((part) => typeContainsSafeBrand(part, [name]))) context.report({node, messageId: "cast", data: {name}});
    }
    function inspectArguments(node: TSESTree.CallExpression | TSESTree.NewExpression): void {
      const signature = checker.getResolvedSignature(services.esTreeNodeToTSNodeMap.get(node));
      if (!signature) return;
      const parameters = signature.getParameters();
      node.arguments.forEach((argument, index) => {
        if (argument.type === AST_NODE_TYPES.SpreadElement || !isAnyType(typeAt(context, argument))) return;
        const parameter = parameters[Math.min(index, parameters.length - 1)];
        const declaration = parameter?.valueDeclaration ?? parameter?.declarations?.[0];
        if (!parameter || !declaration) return;
        const expected = checker.getTypeOfSymbolAtLocation(parameter, declaration);
        if (typeContainsSafeBrand(expected, SAFE_TYPES)) context.report({node: argument, messageId: "any"});
      });
    }
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "next-xss-sbyd") return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) continue;
          const imported = specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : String(specifier.imported.value);
          const prop = imported === "SafeBlock" ? "html" : imported === "SafeScriptBlock" ? "script" : imported === "SafeStyleBlock" ? "css" : null;
          if (prop) safeComponents.set(specifier.local.name, prop);
        }
      },
      TSAsExpression: inspectAssertion,
      TSTypeAssertion: inspectAssertion,
      TSSatisfiesExpression: inspectAssertion,
      CallExpression: inspectArguments,
      NewExpression: inspectArguments,
      VariableDeclarator(node) {
        if (node.init && node.id.type !== AST_NODE_TYPES.ArrayPattern && node.id.type !== AST_NODE_TYPES.ObjectPattern) {
          inspectAnyFlow(node.init, node.id);
        }
      },
      AssignmentExpression(node) {
        if (node.left.type !== AST_NODE_TYPES.ArrayPattern && node.left.type !== AST_NODE_TYPES.ObjectPattern) inspectAnyFlow(node.right, node.left);
      },
      ReturnStatement(node) {
        if (node.argument) inspectContextualAny(node.argument);
      },
      Property(node) {
        if (node.parent.type === AST_NODE_TYPES.ObjectExpression &&
            node.value.type !== AST_NODE_TYPES.AssignmentPattern &&
            node.value.type !== AST_NODE_TYPES.TSEmptyBodyFunctionExpression) {
          inspectContextualAny(node.value);
        }
      },
      PropertyDefinition(node) {
        if (node.value) inspectAnyFlow(node.value, node);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== AST_NODE_TYPES.JSXIdentifier) return;
        const prop = safeComponents.get(node.name.name);
        if (!prop) return;
        const attribute = node.attributes.find((candidate) => candidate.type === AST_NODE_TYPES.JSXAttribute && candidate.name.type === AST_NODE_TYPES.JSXIdentifier && candidate.name.name === prop);
        if (attribute?.type !== AST_NODE_TYPES.JSXAttribute || attribute.value?.type !== AST_NODE_TYPES.JSXExpressionContainer || attribute.value.expression.type === AST_NODE_TYPES.JSXEmptyExpression) return;
        if (isAnyType(typeAt(context, attribute.value.expression))) context.report({node: attribute.value.expression, messageId: "any"});
      },
    };
  },
});
