# Dependency style integrations under an enforcing CSP

The default policy includes `style-src-attr 'unsafe-inline'`, so React style props
and dependency-generated style attributes work during server rendering, hydration,
and client navigation. No attribute migration or opt-in is needed, and there is no
option to deny style attributes. This allowance does not authorize `<style>` elements:
`style-src-elem 'self' 'nonce-…'` requires a matching nonce for inline stylesheets.
Browsers without the granular style directives use the permissive legacy fallback
described in the [style policy guide](csp-styles.md). Script restrictions are unchanged.

Use ordinary Next Image, Radix, react-dropzone, react-masonry-css, and cmdk controls,
including their generated attributes. Preserve their layout and accessibility behavior.
This guide covers stylesheet elements inserted by Radix, next-themes, and Sonner.
For browsers enforcing `style-src-elem`, these libraries need the document nonce or
a supported external stylesheet integration. See the [style policy guide](csp-styles.md).

The production fixture in [`fixtures/next16`](../fixtures/next16) pins Next.js 16.3.2,
next-themes 0.4.6, Sonner 2.0.7, and get-nonce 1.0.1. Its Radix dependencies use
react-style-singleton 2.2.3. Keep the lockfile and recheck stylesheet insertion after
upgrades.

<a id="carry-the-document-nonce-across-the-client-boundary"></a>

## Carry the document nonce into client components

For Next.js 16, put this in `proxy.ts`:

```ts
import {createXssSbydHandler} from "next-xss-sbyd/csp";

export const proxy = createXssSbydHandler();
export const config = {
  matcher: ["/((?!api/csp-report|_next/static|_next/image|favicon.ico).*)"],
};
```

Next.js 14/15 use `middleware.ts` and `export const middleware` instead. Add the
reporting configuration from [the rollout guide](csp-rollout.md) when deploying.
Use `getNonce()` in a Server Component to pass the document nonce to client
libraries. For example, in `app/layout.tsx`:

```tsx
import type {ReactNode} from "react";
import {getNonce} from "next-xss-sbyd/csp";
import {Providers} from "./providers";
import "sonner/dist/styles.css";
import "./styles.css";

/** Supplies the current document nonce to browser integrations. */
export default async function RootLayout({children}: {children: ReactNode}) {
  const nonce = await getNonce();
  return (
    <html lang="en" suppressHydrationWarning>
      <body><Providers nonce={nonce}>{children}</Providers></body>
    </html>
  );
}
```

`getNonce()` uses server request headers; never import it into browser code. The
header API also makes this layout dynamic. Do not reuse this HTML through static,
Incremental Static Regeneration (ISR), or Partial Prerendering (PPR) caching. Put the provider
above the routes that navigate between each
other so it persists for the lifetime of the document. A client navigation's React Server Component (RSC)
response does not replace the document's CSP; a newer request nonce must not replace
the nonce used by later styles in the existing document.

`app/providers.tsx`:

```tsx
"use client";

import {useState, type ReactNode} from "react";
import {setNonce} from "get-nonce";
import {ThemeProvider} from "next-themes";
import {Toaster} from "sonner";

/** Initializes browser-only stylesheet state before rendering descendants. */
export function Providers({nonce, children}: {nonce: string; children: ReactNode}) {
  const [documentNonce] = useState(nonce);
  if (typeof window !== "undefined") setNonce(documentNonce);
  return (
    <ThemeProvider nonce={documentNonce} attribute="data-theme"
      defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
```

Client Components also render on the server. The `window` guard prevents storing a
request nonce in shared server-global `get-nonce` state. Initialization must precede
descendant style insertion; a parent component's `useEffect` callback can run too late. The
shared browser instance here serves one document, whose nonce remains stable until a full reload.
The intentional `<html>` hydration suppression accommodates next-themes' pre-hydration
theme attribute; it must not mask unrelated component hydration failures.

## Radix stylesheet elements

The Dialog scroll-lock dependency inserts a stylesheet through
`react-style-singleton`. Initialize its `get-nonce` store before descendants render,
as in `Providers` above. The store must be the same installed copy read by the
stylesheet manager. Inspect the dependency tree and review changes if multiple copies
are present:

```sh
npm ls get-nonce react-style-singleton react-remove-scroll
```

`Select.Viewport` inserts a scrollbar stylesheet outside the scroll-lock singleton.
Pass the document nonce through its `nonce` prop as well. A nonce on a wrapper
`<div>` does not authorize a generated `<style>` element. Verify each generated
stylesheet's `.nonce` property, scroll locking, keyboard focus, focus restoration,
and reopening after `<Link>` navigation. Select, Tabs, and Switch may retain their
normal server-rendered style attributes.

## next-themes and Sonner

The provider's `nonce` authorizes next-themes 0.4.6's initial anti-flash script. This
version also passes it to the temporary `<style>` inserted by
`disableTransitionOnChange`; that option can remain enabled with the nonce. Inspect
both paths after an upgrade. The runtime color-scheme update uses an individual
CSSOM assignment. See [the provider API](https://github.com/pacocoursey/next-themes#api).

For a hydration-stable theme button and a toast trigger, use a Client Component:

```tsx
"use client";

import {useTheme} from "next-themes";
import {toast} from "sonner";

/** Exposes deterministic theme controls and a dismissible toast. */
export function DisplayControls() {
  const {setTheme} = useTheme();
  return <>
    <button onClick={() => setTheme("dark")}>Dark theme</button>
    <button onClick={() => setTheme("light")}>Light theme</button>
    <button onClick={() => toast("Saved", {id: "saved", duration: Infinity})}>Save</button>
    <button onClick={() => toast.dismiss("saved")}>Dismiss toast</button>
  </>;
}
```

```css
html[data-theme="light"] { background: white; color: black; }
html[data-theme="dark"] { background: #181818; color: white; }
```

Seed a stored theme before navigation and inspect the initial document theme as well
as toggling it after hydration. Theme-dependent text needs its own mounted-state
handling if the server cannot know the user's stored preference.

The layout imports `sonner/dist/styles.css`, an exported path in Sonner 2.0.7.
Its CSS is bundled into a same-origin stylesheet. Sonner also attempts redundant
runtime style injection without a nonce, which can be blocked and reported even when
the imported CSS renders the toast correctly. This is the specific
[upstream incompatibility](https://github.com/emilkowalski/sonner/issues/449), not
permission to ignore every Sonner or style violation. Verify toast dimensions,
position, computed styling, visibility, and dismissal. Any permitted report must
match the reviewed dependency, route/action, directive/source, and insertion; unknown
reports fail. Do not maintain a runtime stylesheet hash list.

The reviewed Sonner 2.0.7 record is: initial `/csp-styles` load, two
`style-src-elem` events (`blockedURI: "inline"`) for the same `<style>` element,
from the same-origin production `/_next/static/chunks/*.js` module. The inserted
text begins `[data-sonner-toaster][dir=ltr],html[dir=ltr]`. The rationale is solely
that the imported CSS supplies the same toast styling while the redundant injection
is blocked. The test verifies that prefix and element identity as well as the
route/action, source, count, disposition (report-only or enforcing), and functional toast assertions. It does
not rely on the browser's truncated `sample` to identify the stylesheet.

## Verify dependency stylesheet elements in production

Run production browser checks from the repository root:

```sh
npm ci
npm run test:compat -- next16
```

Set `CHROME_PATH` if Chrome is outside the runner's standard locations. To require
WebKit, install the browser matching the pinned Playwright dependency with
`npx playwright-core install webkit`, then run
`CSP_WEBKIT=1 npm run test:compat -- next16`.

Check first paint, hydration, navigation, image geometry, hidden inputs and labels,
file selection, menu positioning, keyboard interaction, and route announcements.
Style attributes should apply without `style-src-attr` violations. Separately verify
that missing or wrong stylesheet nonces, unauthorized scripts, and inline event
handlers are blocked. Report-only behavior cannot establish enforcement.

Review each remaining stylesheet report against the installed dependency and the
actual inserted element. Allow a known redundant insertion report only after proving
that authorized CSS supplies the required behavior, as described for Sonner above.
Unknown reports, hydration errors, and accessibility regressions need investigation.
Validate deployed report delivery using the [CSP rollout guide](csp-rollout.md).
