import {markdownImports} from "../markdown-imports.js";
import {createRule} from "../utils.js";

const RENDERERS = /^(?:react-markdown|markdown-to-jsx|rehype-react|react-remark|marked-react)(?:\/|$)/u;
export default createRule<[], "boundary">({
  name: "require-safe-markdown",
  meta: {type: "suggestion", docs: {description: "Route React Markdown rendering through a reviewed boundary"}, schema: [], messages: {
    boundary: "Use SafeMarkdown from next-xss-sbyd/markdown or a reviewed adapter instead of importing {{source}} here. This enforces a project boundary; a default renderer is not necessarily vulnerable. HTML parsers may feed the final sanitizer and SafeBlock.",
  }},
  defaultOptions: [],
  create(context) {
    return markdownImports(context, (node, source) => {
      if (source !== null && RENDERERS.test(source)) context.report({node, messageId: "boundary", data: {source}});
    });
  },
});
