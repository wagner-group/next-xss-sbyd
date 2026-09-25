"use client";

import type {ComponentProps, ReactElement} from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {markdownSchema, remarkMarkdownLimits, rehypeMarkdownLimits} from "./internal/markdown-policy.js";
import {navigationUrlOrNull, resourceUrlOrNull} from "./url.js";

export interface SafeMarkdownProps {
  children: string;
}

function MarkdownLink({href, title, children}: ComponentProps<"a">): ReactElement {
  const url = navigationUrlOrNull(href ?? "");
  return url === null ? <>{children}</> : <a href={url} title={title} rel="nofollow noopener noreferrer">{children}</a>;
}

function MarkdownImage({src, alt, title}: ComponentProps<"img">): ReactElement {
  // HAST properties are strings; React also types src as Blob for app code.
  const url = resourceUrlOrNull((src as string | undefined) ?? "");
  return url === null ? <>{alt}</> : <img src={url} alt={alt} title={title} referrerPolicy="no-referrer" />;
}

function MarkdownList({start, children}: ComponentProps<"ol">): ReactElement {
  // CommonMark recognizes at most nine digits in ordered-list markers.
  const bounded = start !== undefined && Number.isInteger(start) && start >= 0 && start <= 999999999 ? start : undefined;
  return <ol start={bounded}>{children}</ol>;
}

// react-markdown's URL default differs from our shared policy (e.g. tel:).
// Only the fixed renderers above consume URLs, validating before creating props.
function parsedUrl(value: string): string { return value; }

/**
 * Render untrusted CommonMark with a fixed HTML/URL policy and no plugins/options.
 * Raw HTML is ignored. Invalid links retain text; invalid images retain alt text.
 * Throws TypeError for unsupported props/source and RangeError above 256 KiB
 * UTF-8, 50,000 parsed nodes, or depth 128. These limits are not a CPU timeout.
 */
export function SafeMarkdown(props: SafeMarkdownProps): ReactElement {
  for (const key of Object.keys(props)) {
    if (key !== "children") throw new TypeError(`Unsupported SafeMarkdown prop: ${key}`);
  }
  const {children} = props;
  if (typeof children !== "string") throw new TypeError("SafeMarkdown requires a string child");
  // The cheap code-unit guard avoids allocating an unbounded encoding buffer.
  if (children.length > 262144 || new TextEncoder().encode(children).length > 262144) {
    throw new RangeError("SafeMarkdown exceeds 256 KiB of UTF-8 input");
  }
  return <Markdown skipHtml remarkPlugins={[remarkMarkdownLimits]}
    rehypePlugins={[rehypeMarkdownLimits, [rehypeSanitize, markdownSchema]]}
    urlTransform={parsedUrl} components={{a: MarkdownLink, img: MarkdownImage, ol: MarkdownList}}>{children}</Markdown>;
}
