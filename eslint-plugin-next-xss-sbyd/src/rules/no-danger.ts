import ts from "typescript";
import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {createRule, jsxAttribute, jsxSpreadPropertyTypes, rawReactFactory, reactFactoryBindings, recordReactImport, recordReactImportEquals, recordReactVariable, typeAt} from "../utils.js";

export default createRule({
  name: "no-danger",
  meta: {type: "problem", docs: {description: "Disallow raw HTML injection in JSX"}, schema: [], messages: {
    danger: "Do not use dangerouslySetInnerHTML or __html. Render a SafeHtml value with <SafeBlock>.",
  }},
  defaultOptions: [],
  create(context) {
    const options = context.sourceCode.parserServices?.program?.getCompilerOptions();
    const runtimeEnabled = options?.jsxImportSource === "next-xss-sbyd";
    const bindings = reactFactoryBindings();

    function mayContainRawHtml(node: TSESTree.CallExpressionArgument | undefined): boolean {
      if (!node || node.type === AST_NODE_TYPES.SpreadElement) return false;
      if (node.type === AST_NODE_TYPES.Literal && node.value === null) return false;
      const type = typeAt(context, node);
      if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
      return type.getProperties().some((property) => property.getName().toLowerCase().startsWith("dangerously"));
    }

    return {
      ImportDeclaration(node) {
        recordReactImport(bindings, node);
      },
      TSImportEqualsDeclaration(node) { recordReactImportEquals(bindings, node); },
      VariableDeclarator(node) { recordReactVariable(bindings, node); },
      JSXOpeningElement(node) {
        const attribute = jsxAttribute(node, "dangerouslySetInnerHTML");
        if (attribute) context.report({node: attribute, messageId: "danger"});
        if (!runtimeEnabled) {
          for (const spread of jsxSpreadPropertyTypes(context, node, "dangerouslySetInnerHTML")) {
            context.report({node: spread.attribute, messageId: "danger"});
          }
        }
      },
      CallExpression(node) {
        if (rawReactFactory(bindings, node.callee) && mayContainRawHtml(node.arguments[1])) {
          context.report({node, messageId: "danger"});
        }
      },
      Property(node) {
        const key = node.key;
        if ((key.type === AST_NODE_TYPES.Identifier && key.name === "__html") ||
            (key.type === AST_NODE_TYPES.Literal && key.value === "__html")) {
          context.report({node: key, messageId: "danger"});
        }
      },
    };
  },
});
