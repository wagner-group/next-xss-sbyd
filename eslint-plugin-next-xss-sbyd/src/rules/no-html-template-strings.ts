import {AST_NODE_TYPES, type TSESTree} from "@typescript-eslint/utils";
import {createRule} from "../utils.js";

type Options = [{excludedTags?: string[]}?];
export default createRule<Options, "htmlTemplate">({
  name: "no-html-template-strings",
  meta: {type: "suggestion", docs: {description: "Flag interpolated HTML-looking template strings"}, schema: [{type: "object", additionalProperties: false, properties: {excludedTags: {type: "array", items: {type: "string"}, uniqueItems: true}}}], messages: {
    htmlTemplate: "This interpolated template looks like HTML and may be context-unsafe. Build JSX; use safeRenderToString when SafeHtml is needed. For intentional test fixtures or non-HTML matches, use a reviewed line-level disable with a justification. See https://github.com/davidwagner/next-xss-sbyd/blob/main/docs/retrofit.md#resolve-html-template-string-errors.",
  }},
  defaultOptions: [{}],
  create(context, [options]) {
    const excluded = new Set(options?.excludedTags ?? []);
    return {TemplateLiteral(node: TSESTree.TemplateLiteral) {
      if (node.expressions.length === 0) return;
      if (node.parent.type === AST_NODE_TYPES.TaggedTemplateExpression &&
          node.parent.tag.type === AST_NODE_TYPES.Identifier && excluded.has(node.parent.tag.name)) return;
      // Ignore the regex negative-lookbehind marker (?<!, but keep real tags,
      // comments and doctypes visible even when they follow a (? text prefix.
      if (/<[a-z]|<!--|<!doctype|(?<!\(\?)<!/i.test(node.quasis.map((part) => part.value.raw).join(""))) {
        context.report({node, messageId: "htmlTemplate"});
      }
    }};
  },
});
