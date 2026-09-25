import type {Options} from "rehype-sanitize";

// This is a fresh schema, not a mutation of rehype-sanitize's shared default.
// No global attributes, DOM names, styling, controls, or executable namespaces.
export const markdownSchema: Options = {
  tagNames: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "blockquote", "ul", "ol", "li", "strong", "em", "pre", "code", "a", "img"],
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    ol: ["start"],
  },
  protocols: {href: ["http", "https", "mailto", "tel"], src: ["http", "https"]},
  strip: ["script", "style", "iframe", "object", "svg", "math"],
  clobber: ["id", "name"],
};

type TreeNode = {children?: TreeNode[]};

/** Reject oversized trees before downstream recursive transforms traverse them. */
function checkTree(root: TreeNode): void {
  const pending = [{node: root, depth: 0}];
  let count = 0;
  while (pending.length) {
    const {node, depth} = pending.pop()!;
    if (++count > 50000) throw new RangeError("SafeMarkdown exceeds 50,000 nodes");
    if (depth > 128) throw new RangeError("SafeMarkdown exceeds nesting depth 128");
    if (node.children) {
      for (const child of node.children) pending.push({node: child, depth: depth + 1});
    }
  }
}

// Unified deduplicates plugins by function identity. Distinct attachers ensure
// both the Markdown tree and the expanded HTML tree are checked at their stage.
/** Check Markdown nodes before remark-rehype recursively converts them. */
export function remarkMarkdownLimits() { return checkTree; }
/** Check HTML nodes before rehype-sanitize recursively traverses them. */
export function rehypeMarkdownLimits() { return checkTree; }
