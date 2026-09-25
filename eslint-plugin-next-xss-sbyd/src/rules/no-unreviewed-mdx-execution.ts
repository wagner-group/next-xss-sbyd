import {markdownImports} from "../markdown-imports.js";
import {createRule} from "../utils.js";

const EXECUTION = new Set(["createProcessor", "compile", "compileSync", "evaluate", "evaluateSync", "run", "runSync"]);
export default createRule<[], "boundary">({
  name: "no-unreviewed-mdx-execution",
  meta: {type: "problem", docs: {description: "Require review of MDX compilation and execution boundaries"}, schema: [], messages: {
    boundary: "{{source}} exposes MDX compilation or execution. Keep this import in reviewed application code with source authorization, owner, justification, and tests. CMS authentication or HTML sanitization does not establish code trust; do not relax CSP automatically.",
  }},
  defaultOptions: [],
  create(context) {
    return markdownImports(context, (node, source, imported) => {
      if (source !== null && (
        /^(?:next-mdx-remote|next-mdx-remote-client|mdx-bundler)(?:\/|$)/u.test(source) ||
        (source === "@mdx-js/mdx" && (imported === undefined || EXECUTION.has(imported))) ||
        source.startsWith("@mdx-js/mdx/")
      )) context.report({node, messageId: "boundary", data: {source}});
    });
  },
});
