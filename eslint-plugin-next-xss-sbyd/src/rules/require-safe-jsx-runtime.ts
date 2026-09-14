import {createRule, rawReactFactory, reactFactoryBindings, recordReactImport, recordReactImportEquals, recordReactVariable} from "../utils.js";

type Message = "config" | "pragma" | "runtimeImport" | "factoryBypass";

/** Ensures application JSX cannot bypass the validating JSX runtime. */
export default createRule<[], Message>({
  name: "require-safe-jsx-runtime",
  meta: {type: "problem", docs: {description: "Require the validating JSX runtime and reject direct bypasses"}, schema: [], messages: {
    config: "Set compilerOptions.jsxImportSource to 'next-xss-sbyd' so JSX props are validated at runtime.",
    pragma: "Do not override @jsxImportSource; it bypasses next-xss-sbyd JSX validation.",
    runtimeImport: "Import JSX runtime functions through next-xss-sbyd, not React directly.",
    factoryBypass: "This element factory call bypasses next-xss-sbyd JSX validation.",
  }},
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode;
    const bindings = reactFactoryBindings();
    return {
      Program(node) {
        const services = sourceCode.parserServices;
        const options = services?.program?.getCompilerOptions();
        if (options && options.jsxImportSource !== "next-xss-sbyd") context.report({node, messageId: "config"});
        const pragma = sourceCode.getAllComments().find((comment) => /@jsx(?:ImportSource|Runtime)?\b/u.test(comment.value));
        if (pragma) context.report({node: pragma, messageId: "pragma"});
      },
      ImportDeclaration(node) {
        if (node.source.value === "react/jsx-runtime" || node.source.value === "react/jsx-dev-runtime") {
          context.report({node, messageId: "runtimeImport"});
        }
        recordReactImport(bindings, node);
      },
      TSImportEqualsDeclaration(node) { recordReactImportEquals(bindings, node); },
      VariableDeclarator(node) { recordReactVariable(bindings, node); },
      CallExpression(node) {
        if (rawReactFactory(bindings, node.callee)) context.report({node, messageId: "factoryBypass"});
      },
    };
  },
});
