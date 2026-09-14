# Styles under nonce CSP

The default policy emits `style-src-attr 'unsafe-inline'`. Ordinary React `style`
props, including custom properties and server-rendered dependency attributes, are
allowed without a nonce. Existing inline attributes do not need to be converted to
classes or stylesheets. There is no option to deny style attributes.

Stylesheet elements remain restricted in browsers supporting `style-src-elem` by
`style-src-elem 'self' 'nonce-…'`: same-origin stylesheet files and matching nonce-bearing `<style>` elements are allowed. Adding
an origin through `styleSrc` authorizes stylesheet delivery from that origin and does
not change the attribute policy. Caller-supplied `'unsafe-inline'`, `'unsafe-eval'`,
and `'unsafe-hashes'` remain rejected in source-list options. The builder itself adds
the attribute and legacy fallback allowances; it does not relax script or inline
event-handler protections.

The legacy fallback is `style-src 'self' 'unsafe-inline'`, without a nonce source.
Browsers without the granular style directives still apply ordinary style attributes
and inline stylesheets, including nonce-bearing stylesheets. They also allow inline
stylesheets with missing or wrong nonces. Browsers supporting `style-src-elem`
require the matching nonce for inline stylesheets. This fallback preserves layout
on older browsers; script restrictions remain unchanged.

A CSP allowance does not sanitize CSS. Keep untrusted content out of stylesheet
bodies and use the existing safe APIs for application-owned inline stylesheets.
The `no-dynamic-script-style` rule continues to protect script and style bodies.

## Use a fixed inline stylesheet when needed

For a small fixed stylesheet that must be inline, reuse the existing safe APIs:

```tsx
import { SafeStyleBlock, safeStyleSheet } from "next-xss-sbyd";
import { getNonce } from "next-xss-sbyd/csp";

export default async function Page() {
  const nonce = await getNonce();
  return (
    <>
      <SafeStyleBlock
        nonce={nonce}
        css={safeStyleSheet`.app-notice { color: green; padding: 8px; }`}
      />
      <div className="app-notice">Saved</div>
    </>
  );
}
```

Use this in a server component on a dynamically rendered route with this package's
nonce middleware/proxy. Place shared rules once in a layout; selectors are not scoped
to the adjacent element. `safeStyleSheet` is literal-only: never interpolate user
input or bypass its restriction with a restricted conversion.

Stylesheet elements inserted after client navigation must retain the active document's nonce,
even when a new request supplies a different one. The fixtures' `DocumentNonce`
uses `useState(nonce)` to retain that initial value. Script nonce, dynamic-rendering,
and cache requirements still apply; see the [CSP rollout guide](csp-rollout.md).

## Verify before enforcement

Use a production build with an enforcing HTTP policy:

1. Verify that application and dependency style attributes apply on first paint,
   after hydration, and after client navigation, without attribute violations.
2. In browsers supporting `style-src-elem`, verify that missing or wrong stylesheet
   nonces are blocked. Verify that unauthorized scripts and inline event handlers
   remain blocked in every supported browser.
3. Check later stylesheet insertion against the active document's nonce, including
   retained layouts. Test dialogs, themes, toasts, focus, scrolling, and accessibility
   announcements as actual interactions.
4. Review stylesheet reports individually and verify report delivery in staging.

See the [dependency integration guide](csp-style-integrations.md) for stylesheet
nonce propagation and the [CSP rollout guide](csp-rollout.md) for deployment checks.
