import {markdownImports} from "../markdown-imports.js";
import {createRule} from "../utils.js";

export default createRule<[], "coverage">({
  name: "markdown-loader-coverage",
  meta: {type: "suggestion", docs: {description: "Identify module loaders outside static Markdown boundary coverage"}, schema: [], messages: {
    coverage: "Markdown/MDX coverage limitation: this module loader is not statically resolvable. Review its possible targets and wrappers; absence of a boundary finding is not evidence of safety.",
  }},
  defaultOptions: [],
  create(context) {
    return markdownImports(context, (node, source) => {
      if (source === null) context.report({node, messageId: "coverage"});
    });
  },
});
