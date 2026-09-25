import type {Options} from "rehype-sanitize";

// This is a fresh schema, not a mutation of rehype-sanitize's shared default.
// No global attributes, DOM names, styling, controls, or executable namespaces.
// With raw HTML disabled and no extensions, strip/clobber/protocols are defense
// in depth. Fixed a/img renderers enforce the shared URL policy after this schema.
export const markdownSchema: Options = {
  tagNames: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "blockquote", "ul", "ol", "li", "strong", "em", "pre", "code", "a", "img"],
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    ol: ["start"],
  },
  protocols: {href: ["http", "https", "mailto", "tel"], src: ["http", "https", "mailto", "tel"]},
  strip: ["script", "style", "iframe", "object", "svg", "math"],
  clobber: ["id", "name"],
};

type TreeNode = {type: string; children?: TreeNode[]};

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

/** Bound input and parser-sensitive syntax in a linear scan before parsing. */
export function checkMarkdownSource(source: string): void {
  if (source.length > 32768 || new TextEncoder().encode(source).length > 32768) {
    throw new RangeError("SafeMarkdown exceeds 32 KiB of UTF-8 input");
  }
  let punctuation = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    // Count all ASCII punctuation, including escapes and code. A global budget
    // also bounds reference/delimiter interactions across paragraph boundaries.
    if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64) ||
        (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) {
      if (++punctuation > 1024) throw new RangeError("SafeMarkdown exceeds 1,024 punctuation characters");
    }
  }
  for (const line of source.split(/\r\n?|\n/)) {
    let offset = 0;
    let containers = 0;
    let indentation = 0;
    while (offset < line.length) {
      const char = line[offset];
      if (char === " " || char === "\t") {
        indentation += char === "\t" ? 4 : 1;
        if (indentation > 128) throw new RangeError("SafeMarkdown exceeds indentation 128");
        offset++;
        continue;
      }
      if (char === ">") {
        offset++;
      } else if ((char === "-" || char === "+" || char === "*") && /[ \t]/.test(line[offset + 1] ?? "")) {
        offset++;
      } else {
        let end = offset;
        while (end < line.length && end - offset < 9 && line[end]! >= "0" && line[end]! <= "9") end++;
        if (end === offset || (line[end] !== "." && line[end] !== ")") || !/[ \t]/.test(line[end + 1] ?? "")) break;
        offset = end + 1;
      }
      if (++containers > 128) throw new RangeError("SafeMarkdown exceeds prefix nesting depth 128");
    }
  }
}
