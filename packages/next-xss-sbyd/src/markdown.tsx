import type {ComponentProps, ReactElement} from "react";
import {Fragment, jsx, jsxs} from "react/jsx-runtime";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import {toJsxRuntime} from "hast-util-to-jsx-runtime";
import rehypeSanitize from "rehype-sanitize";
import {checkMarkdownSource, markdownSchema, remarkMarkdownLimits, rehypeMarkdownLimits} from "./internal/markdown-policy.js";
import {validateUrlOrNull} from "./url.js";

export interface SafeMarkdownProps {
  children: string;
}

function MarkdownLink({href, title, children}: ComponentProps<"a">): ReactElement {
  const url = validateUrlOrNull(href ?? "");
  return url === null ? <>{children}</> : <a href={url} title={title} rel="nofollow noopener noreferrer">{children}</a>;
}

function MarkdownImage({src, alt, title}: ComponentProps<"img">): ReactElement {
  // HAST properties are strings; React also types src as Blob for app code.
  const url = validateUrlOrNull((src as string | undefined) ?? "");
  return url === null ? <>{alt}</> : <img src={url} alt={alt} title={title} referrerPolicy="no-referrer" />;
}

function MarkdownList({start, children}: ComponentProps<"ol">): ReactElement {
  // CommonMark recognizes at most nine digits in ordered-list markers.
  const bounded = start !== undefined && Number.isInteger(start) && start >= 0 && start <= 999999999 ? start : undefined;
  return <ol start={bounded}>{children}</ol>;
}

// Freeze a closed, synchronous processor; callers cannot supply transforms.
// remark-rehype drops raw HTML because allowDangerousHtml remains false.
const processor = unified()
  .use(remarkParse)
  .use(remarkMarkdownLimits)
  .use(remarkRehype)
  .use(rehypeMarkdownLimits)
  .use(rehypeSanitize, markdownSchema)
  .freeze();

/**
 * Render untrusted CommonMark with a fixed HTML/URL policy and no plugins/options.
 * Raw HTML is ignored. Invalid links retain text; invalid images retain alt text.
 * Throws TypeError for unsupported props/source and RangeError above 32 KiB
 * UTF-8 or the bounded syntax budget before parsing, or above 50,000 parsed
 * nodes or depth 128 after parsing. These limits are not a CPU timeout.
 */
export function SafeMarkdown(props: SafeMarkdownProps): ReactElement {
  for (const key of Object.keys(props)) {
    if (key !== "children") throw new TypeError(`Unsupported SafeMarkdown prop: ${key}`);
  }
  const {children} = props;
  if (typeof children !== "string") throw new TypeError("SafeMarkdown requires a string child");
  checkMarkdownSource(children);
  const tree = processor.runSync(processor.parse(children));
  return toJsxRuntime(tree, {
    Fragment, jsx, jsxs,
    components: {a: MarkdownLink, img: MarkdownImage, ol: MarkdownList},
  });
}
