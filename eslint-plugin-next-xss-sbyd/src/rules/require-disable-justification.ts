import {createRule} from "../utils.js";

const DIRECTIVE = /^eslint-disable(?:-next-line|-line)?\b(.*)$/u;

export default createRule({
  name: "require-disable-justification",
  meta: {type: "problem", docs: {description: "Require scoped and justified xss-sbyd disable comments"}, schema: [], messages: {
    unlimited: "An xss-sbyd disable must name the specific xss-sbyd rule; unlimited eslint-disable is forbidden.",
    description: "An xss-sbyd disable needs a description after `--` explaining why the escape hatch is safe.",
  }},
  defaultOptions: [],
  create(context) {
    return {Program() {
      for (const comment of context.sourceCode.getAllComments()) {
        const match = DIRECTIVE.exec(comment.value.trim());
        if (!match) continue;
        const [ruleText = "", description = ""] = (match[1] ?? "").split(/\s+--\s+/, 2);
        const rules = ruleText.trim() ? ruleText.split(",").map((rule) => rule.trim()) : [];
        const isUnlimited = rules.length === 0;
        const includesXssSbyd = isUnlimited || rules.some((rule) => rule.startsWith("xss-sbyd/"));
        if (!includesXssSbyd) continue;
        const forceLocation = {start: {line: comment.loc.start.line, column: -1}, end: comment.loc.end};
        if (isUnlimited) context.report({loc: forceLocation, messageId: "unlimited"});
        else if (!description.trim()) context.report({loc: forceLocation, messageId: "description"});
      }
    }};
  },
});
