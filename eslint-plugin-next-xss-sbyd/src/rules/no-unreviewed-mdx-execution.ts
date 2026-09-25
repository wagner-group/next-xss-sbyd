import {markdownImports} from "../markdown-imports.js";
import {createRule} from "../utils.js";

const EXECUTION = new Set(["createProcessor", "compile", "compileSync", "evaluate", "evaluateSync", "run", "runSync"]);
export default createRule<[], "boundary" | "coverage">({
  name: "no-unreviewed-mdx-execution",
  meta: {type: "problem", docs: {description: "Require review of MDX compilation and execution boundaries"}, schema: [], messages: {
    boundary: "{{source}} exposes MDX compilation or execution. Keep this import in reviewed application code with source authorization, owner, justification, and tests. CMS authentication or HTML sanitization does not establish code trust; do not relax CSP automatically.",
    coverage: "MDX coverage limitation: this module loader is not statically resolvable. Review possible execution entry points; unknown loading cannot establish code trust.",
  }},
  defaultOptions: [],
  create(context) {
    return markdownImports(context, (source, imported) =>
      /^(?:next-mdx-remote|@next\/mdx)(?:\/|$)/u.test(source) ||
      (source === "@mdx-js/mdx" && (imported === undefined || EXECUTION.has(imported))) ||
      source.startsWith("@mdx-js/mdx/"));
  },
});
