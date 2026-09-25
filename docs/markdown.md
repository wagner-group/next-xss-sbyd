# Markdown and MDX

Use `SafeMarkdown` for untrusted ordinary Markdown, including user submissions,
CMS articles and AI output. Keep an existing HTML-producing parser when you need
its extensions, then sanitize its final HTML and display it with `SafeBlock`.
MDX executes application code and needs a separate trust decision.

## Ordinary Markdown

```tsx
import {SafeMarkdown} from "next-xss-sbyd/markdown";

export function Article({source}: {source: string}) {
  return <article className="prose"><SafeMarkdown>{source}</SafeMarkdown></article>;
}
```

`children: string` is the only accepted prop. Non-string source and unsupported
props throw at runtime as well as failing TypeScript checks. Put layout, styling
and accessibility attributes on your own wrapper. There are no plugins, custom
components, schemas, URL callbacks, raw-HTML switches or trusted-content modes.

The fixed CommonMark renderer uses a synchronous unified pipeline: `remark-parse`,
`remark-rehype` with raw HTML disabled, a private `rehype-sanitize` schema, and
`hast-util-to-jsx-runtime` with fixed link/image renderers. Raw HTML tokens
are ignored: `<b>word</b>` leaves `word` as ordinary text, while an HTML block can
be ignored entirely. Markdown code fences remain escaped code text. Source such as
`{globalThis.example = true}` is text; Markdown conversion does not evaluate MDX
expressions or fetch resources.

The permitted output consists of headings, paragraphs, lists, emphasis, block
quotes, code, line breaks, separators, links and images. Ordered-list start values
are integers from 0 through 999,999,999. No content-supplied IDs, names, classes, styles, events, custom elements,
forms, frames, SVG or MathML survive. Code-language highlighting classes are removed.
The component returns content without an extra layout element.

Parsed link and image destinations pass through `validateUrlOrNull`, sharing
the URL policy used by JSX and the HTML sanitizer. Both allow HTTP(S),
root-relative paths and supported `mailto:`/`tel:` forms. Accepting a URL does
not guarantee that a browser can load it as an image. Script, data, blob and protocol-relative URLs,
credentials, forbidden control characters and backslashes are rejected. Bare
fragments and document-relative destinations such as `#heading`, `./page` and
`image.png` are also rejected. Invalid links retain their children without navigation;
invalid images become their alternative text. Retained links receive
`rel="nofollow noopener noreferrer"`; images receive `referrerPolicy="no-referrer"`.
There is no content-controlled `target` or `srcSet`.

The separate `next-xss-sbyd/markdown` entry point keeps Markdown dependencies out
of the core import graph. It does not depend on DOMPurify or JSDOM; its Node and
Edge paths do not require a DOM.
The component has no Client Component boundary and imports no React hooks. Server
Components render it entirely on the server without shipping the parser or source
text to the browser. Importing it from a Client Component includes the parser in
that client bundle and supports hydration and browser updates. The Next 14/15/16
fixtures exercise both usages on Node and Edge. Source text can cross an RSC or
JSON boundary when needed; render it where it will be displayed.

The Markdown packages remain direct runtime dependencies, with compatible caret
ranges. They are installed with the package, even when the Markdown subpath is not
used. Keeping them required makes that public entry point work without a separate
installation step; optional peers would shift installation and version management
to every Markdown consumer. The separate entry point isolates their import and
bundle cost, not their installation cost.

### Next 14 with a custom Babel configuration

The Markdown dependencies use native Unicode-property regular expressions. Next 14's
bundled Babel can fail while downleveling them (`Unknown property: P` or
`Failed to recognize value ... ID_Start`). If your application uses `next/babel`,
set explicit browser targets that support those expressions. The production fixture
uses the following options alongside the package's JSX runtime:

```json
{
  "presets": [["next/babel", {
    "preset-react": {"runtime": "automatic", "importSource": "next-xss-sbyd"},
    "preset-env": {
      "targets": {"chrome": "90", "edge": "90", "firefox": "90", "safari": "14"}
    }
  }]]
}
```

This declares those browser minimums for the application; check your supported
browsers before adopting it. The Next 15/16 SWC fixtures need no Babel override.

### Resource limits and fallbacks

Before parsing, a linear scan rejects inputs above **32 KiB of UTF-8**, above
**1,024 ASCII punctuation characters across the entire document**, or with more
than **128 leading container markers** or **128 indentation columns** on any line
(tabs count as four columns). Container markers include block quotes and unordered
or ordered lists. The punctuation budget counts all ASCII punctuation, including
brackets, emphasis, backticks, escapes, URLs and fenced code; it deliberately does
not attempt to parse Markdown. Splitting attacks across paragraphs cannot reset
that budget. Large code samples and punctuation-heavy prose may require a fallback.

After parsing, both Markdown and HTML trees are limited to **50,000 nodes** and
**128 levels of depth** before downstream recursive transforms. Those checks are
defense in depth; they do not interrupt parsing. Limit violations throw
`RangeError`; invalid props/source throw `TypeError`. All checks apply on Node,
Edge and in browsers.

These bounds reject the reported container/delimiter CPU attacks before parsing.
The regression corpus requires each hostile or scaled example to finish within
500 ms on the test machine, with a separate process deadline to kill a hung parser.
That is a regression threshold, **not a hard CPU or memory guarantee** for every
input or platform. **Do not run SafeMarkdown on Edge or on an anonymous request's
synchronous rendering path when a hard latency budget is required.** Parse such
content at ingestion or in an isolated worker with an externally enforced deadline
and serve the reviewed result. Bound request sizes and request rates as well.

A Client Component render error requires a React **error boundary**; a `try/catch`
around JSX creation does not catch it. React error boundaries do not catch SSR
errors: server rendering needs the framework's server error handling or an error
handler around the actual rendering operation. The Next fixtures exercise a client
error boundary. Use escaped text or an error fallback, never an HTML sink:

```tsx
export function ArticleFallback() {
  return <p>This article could not be displayed.</p>;
}
```

HTTP(S) images can still track readers, disclose IP addresses and send cookies
under browser rules. Restrict production CSP `img-src` to intended destinations.
The renderer's URL checks do not validate image bytes or provide an image proxy.

## Keep an HTML-producing parser

Finish parsing, highlighting, URL resolution and every other HTML-string
transformation before calling `sanitizeUserHtml`. For example, in an async Node
Server Component:

```tsx
import {marked} from "marked";
import {SafeBlock} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

export async function Article({source}: {source: string}) {
  const finishedHtml = await marked.parse(source);
  return <SafeBlock html={sanitizeUserHtml(finishedHtml)} />;
}
```

For `markdown-it`, substitute `md.render(source)`. For unified, pass the finished
HTML string after all transforms. The flow is:

```text
Markdown → parser and all HTML transforms → sanitizeUserHtml → SafeHtml → SafeBlock
```

Never display an intermediate result, cast parser output to `SafeHtml`, concatenate
markup after sanitization, or apply unreviewed components/transforms after the
safety boundary. Parser and plugin code itself remains trusted application code;
sanitization constrains its output, not what it executes while producing that output.

This path supports Node and browsers with a DOM, not Edge or DOM-less workers.
Create and consume `SafeHtml` in the same environment. Do not serialize it through
RSC props, JSON or storage: server-render the block, or send source text and render
locally. Client Components also render on the server; check hydration using
representative malformed input. See [the sanitizer guide](sanitize.md) for the
complete policy, transport rules and environment limits.

### Fidelity checklist

Review these differences before migrating each rendering site:

| Feature | `SafeMarkdown` | HTML parser plus `sanitizeUserHtml` |
| --- | --- | --- |
| CommonMark formatting | Supported | Permitted HTML formatting survives |
| Raw HTML | Ignored | Sanitized under the fixed HTML policy |
| Tables and strikethrough | No GFM profile | Permitted table and deletion elements survive |
| Task checkboxes | No GFM profile | Controls removed |
| Heading anchors, footnotes, TOCs | No generated IDs or fragment navigation | IDs/names and fragment destinations removed |
| Highlighting | Code text retained, no language classes | Classes/styles removed; code text survives |
| Math and diagrams | No extensions | SVG/MathML removed; custom rendering needs review |
| Document-relative images and links | Rejected | Resolve in reviewed importer code before final sanitization |
| Custom React components | Not accepted | Sanitizing an earlier tree cannot secure later components |

Resolve document-relative URLs against a trusted article base in reviewed importer
code before final HTML sanitization. That does not restore stripped fragment targets.
Do not weaken the global sanitizer to recover a single renderer's formatting.
A richer Markdown profile needs its own reviewed design; arbitrary plugins are not
a supported extension mechanism.

## Existing library integrations

These are integration families, not a popularity ranking. Review the installed
version and the complete pipeline when retaining a custom renderer.

| Library | Security boundary and migration |
| --- | --- |
| `react-markdown` | Its default renderer is safe, but URL overrides, plugins and component replacements can change that. Prefer the closed `SafeMarkdown` API. [Upstream security guidance](https://github.com/remarkjs/react-markdown#security) |
| `marked` | Produces unsanitized HTML. Sanitize the finished result and render through `SafeBlock`. [Upstream usage](https://marked.js.org/#usage) |
| `markdown-it` | Keep HTML disabled where possible; sanitize the final HTML to enforce this package's policy independently of parser options. [Upstream safety guidance](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md) |
| remark / rehype / unified | Finish transforms before the final sanitizer. React-output components require their own review. [rehype-sanitize security guidance](https://unifiedjs.com/explore/package/rehype-sanitize/#security) |
| `markdown-to-jsx` | Review the installed version, raw-HTML handling, expression evaluation and overrides. Its `sanitizer` option concerns URLs, not the whole rendering boundary. [Upstream options](https://github.com/quantizor/markdown-to-jsx#optionssanitizer) |
| MDX / `@next/mdx` / `next-mdx-remote` | Treat authoring and execution as application-code trust. Use ordinary Markdown for untrusted content. [MDX evaluation](https://mdxjs.com/packages/mdx/#evaluatefile-options), [Next integration](https://nextjs.org/docs/app/guides/mdx) |

## MDX is application code

Reviewed repository MDX can be deployed as code. A CMS login, literal string or
same-origin fetch alone does not authorize its author to execute server JavaScript.
Review source authorization and generated-code execution together. A `SafeBlock`
around MDX output cannot undo code already executed by compilation or evaluation.
Do not automatically relax CSP with `unsafe-eval` to support remote MDX.

## Inventory and enforce incrementally

Add the opt-in Markdown preset alongside the ordinary recommended preset:

```js
import xssSbyd from "eslint-plugin-next-xss-sbyd";

export default [
  ...xssSbyd.configs.recommended,
  ...xssSbyd.configs.markdown,
];
```

For a warning-only migration, use `configs.lintMigration` together with
`configs.markdownMigration`. Record the selection in the application's `package.json`
so configuration checks enforce the Markdown preset at the selected setup stage:

```json
{
  "next-xss-sbyd": {
    "markdown": true
  }
}
```

Keep any existing `stage` and other configuration fields. At `lint`/`runtime`,
configuration checks require the warning preset; at `recommended` and later,
they require the error preset for known renderer/execution boundaries. The separate
`markdown-loader-coverage` rule stays a warning at every stage and emits one
diagnostic per unresolved loader. Run the normal checks and inventory before enforcing:

```sh
npx next-xss-sbyd check-config .
npx next-xss-sbyd audit . --recommended --json
```

`require-safe-markdown` routes direct React Markdown renderer dependencies through
`SafeMarkdown` or a reviewed adapter. Its diagnostic enforces a project boundary;
a default `react-markdown` import alone is not evidence of XSS. HTML parsers remain
allowed, with their strings subject to the existing HTML-sink rules.
`no-unreviewed-mdx-execution` identifies MDX execution dependencies outside reviewed
code. Neither rule automatically removes options or plugins.

Start with the audit's Markdown inventory and migrate one rendering site at a time.
Review renderer imports, configuration sites, raw-HTML plugins, HTML sinks, MDX
execution and unknown wrappers. The audit inventory warning requires the package opt-in; explicit inventory remains
available without it. The inventory includes `.md`/`.mdx` discovery;
finding those files does not analyze executable MDX contents. Dynamic loading,
unknown wrappers and configuration remain coverage limitations. Preserve narrow
file-scoped exceptions with justification, owner and tests, and retain the existing
HTML-sink and unsafe-cast rules.

## Verify the rendering boundary

Run `npm run test:compat` with the fixture dependencies and browser prerequisites
installed. [The production checks](../scripts/test-markdown-next.mjs) exercise
Next 14/15/16 Node and Edge pages with JavaScript disabled for SSR inspection,
then hydration and client updates. They run first with report-only CSP, so a
blocking policy cannot conceal a renderer failure, and then with production
CSP enforcement. Assertions cover DOM structure, fallback text, real navigation,
resource requests, execution markers and hydration errors.

The hostile corpus includes raw HTML, event attributes, mixed-case/entity-encoded
script URLs, data/blob/protocol-relative URLs, SVG/MathML, clobbering IDs, malformed
nesting and MDX-looking text. Package tests cover rejected options and resource
limits. Run `npm run test:markdown-browser` for the production React harness in
Chromium, Firefox and WebKit with no CSP and with an enforced CSP; it checks
option rejection, input/tree limits, image referrers and real navigation as well. For a retained HTML pipeline, also test plugin-generated markup after
all transformations; do not infer its safety from the plain Markdown fixture.
