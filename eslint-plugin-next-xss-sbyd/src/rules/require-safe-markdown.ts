import {markdownImports} from "../markdown-imports.js";
import {createRule} from "../utils.js";

const RENDERERS = /^(?:react-markdown|markdown-to-jsx)(?:\/|$)/u;
export default createRule<[], "boundary" | "coverage">({
  name: "require-safe-markdown",
  meta: {type: "suggestion", docs: {description: "Route React Markdown rendering through a reviewed boundary"}, schema: [], messages: {
    boundary: "Use SafeMarkdown from next-xss-sbyd/markdown or a reviewed adapter instead of importing {{source}} here. This enforces a project boundary; a default renderer is not necessarily vulnerable. HTML parsers may feed the final sanitizer and SafeBlock.",
    coverage: "Markdown coverage limitation: this module loader is not statically resolvable. Review its possible targets and wrappers; absence of a renderer finding is not evidence of safety.",
  }},
  defaultOptions: [],
  create(context) { return markdownImports(context, (source) => RENDERERS.test(source)); },
});
