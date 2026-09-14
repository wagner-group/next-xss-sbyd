import {AST_NODE_TYPES} from "@typescript-eslint/utils";
import {createRule} from "../utils.js";

const BANNED = new Set(["renderToString", "renderToStaticMarkup", "renderToPipeableStream", "renderToReadableStream"]);
const REACT_SERVER_ENTRYPOINT = /^react-dom\/server(?:\.(?:browser|bun|edge|node))?$/u;

export default createRule({
  name: "no-raw-render-to-string",
  meta: {type: "problem", docs: {description: "Require safe React server renderer wrappers"}, schema: [], messages: {
    rawRenderer: "Use the safe replacement for {{name}} from next-xss-sbyd/render, not react-dom/server.",
  }},
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        if (typeof node.source.value !== "string" || !REACT_SERVER_ENTRYPOINT.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            context.report({node: specifier, messageId: "rawRenderer", data: {name: "server renderers"}});
            continue;
          }
          if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) continue;
          const imported = specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : String(specifier.imported.value);
          if (BANNED.has(imported)) context.report({node: specifier, messageId: "rawRenderer", data: {name: imported}});
        }
      },
      ImportExpression(node) {
        if (node.source.type === AST_NODE_TYPES.Literal && typeof node.source.value === "string" && REACT_SERVER_ENTRYPOINT.test(node.source.value)) {
          context.report({node, messageId: "rawRenderer", data: {name: "server renderers"}});
        }
      },
      ExportNamedDeclaration(node) {
        if (typeof node.source?.value !== "string" || !REACT_SERVER_ENTRYPOINT.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const exported = specifier.local.type === AST_NODE_TYPES.Identifier ? specifier.local.name : String(specifier.local.value);
          if (BANNED.has(exported)) context.report({node: specifier, messageId: "rawRenderer", data: {name: exported}});
        }
      },
      ExportAllDeclaration(node) {
        if (typeof node.source.value === "string" && REACT_SERVER_ENTRYPOINT.test(node.source.value)) {
          context.report({node, messageId: "rawRenderer", data: {name: "server renderers"}});
        }
      },
    };
  },
});
