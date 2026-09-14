import assert from "node:assert/strict";
import test from "node:test";

import {
  formActionUrl,
  navigationUrl,
  navigationUrlOrNull,
  pathSegment,
  queryValue,
  relativePath,
  relativeResourcePath,
  resourceUrl,
  resourceUrlOrNull,
  withQuery,
} from "next-xss-sbyd";

test("navigation URLs canonicalize allowed schemes and root-relative paths", () => {
  assert.equal(navigationUrl("/a/../b?q=1#two"), "/b?q=1#two");
  assert.equal(navigationUrl("HTTPS://Example.COM:443/a"), "https://example.com/a");
  assert.equal(navigationUrl("mailto:user@example.com"), "mailto:user@example.com");
  assert.equal(navigationUrl("tel:+1-510-555-0100"), "tel:+1-510-555-0100");
});

test("navigation URL validation rejects ambiguous and executable inputs", () => {
  for (const value of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\u0009script:alert(1)",
    "\\\\evil.test/x",
    "//evil.test/x",
    "https://user:pass@example.test/",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.test/id",
    "mailto:user%0a@example.test",
    "mailto://evil.test/path",
    "tel:alert(1)",
    "mailto:%E0%A4%A",
    "relative/path",
  ]) {
    assert.throws(() => navigationUrl(value), /navigation URL/i, value);
    assert.equal(navigationUrlOrNull(value), null, value);
  }
  assert.equal(navigationUrl("/%6a%61vascript:alert(1)"), "/%6a%61vascript:alert(1)");
});

test("resource URLs allow only passive HTTP(S) and root-relative resources", () => {
  assert.equal(resourceUrl("/images/../avatar.png"), "/avatar.png");
  assert.equal(resourceUrl("https://EXAMPLE.test:443/a.png"), "https://example.test/a.png");
  assert.equal(resourceUrlOrNull("/images/../avatar.png"), "/avatar.png");
  assert.equal(resourceUrlOrNull("https://EXAMPLE.test:443/a.png"), "https://example.test/a.png");
  for (const value of [
    "mailto:user@example.test",
    "tel:+15550100",
    "data:image/png;base64,AAAA",
    "blob:https://example.test/id",
    "//cdn.example.test/a.js",
    "https://user@example.test/a.png",
    "\\evil.test\\a.png",
  ]) {
    assert.throws(() => resourceUrl(value), /resource URL/i, value);
    assert.equal(resourceUrlOrNull(value), null, value);
  }
});

test("form actions are same-origin root-relative URLs", () => {
  assert.equal(formActionUrl("/submit/../account?save=1"), "/account?save=1");
  for (const value of [
    "https://example.test/submit",
    "//example.test/submit",
    "submit",
    "/ok\\bad",
    "/safe/..//evil.example/collect",
    "/safe/%2e%2e//evil.example/collect",
  ]) {
    assert.throws(() => formActionUrl(value), /form action URL/i, value);
  }
});

test("nullable URL builders do not hide caller programming errors", () => {
  for (const build of [navigationUrlOrNull, resourceUrlOrNull]) {
    assert.throws(() => build(null), TypeError, build.name);
  }
});

test("path and query interpolation cannot become URL syntax", () => {
  const navigation = relativePath("/things", pathSegment("../admin?q=x#y"));
  assert.equal(navigation, "/things/..%2Fadmin%3Fq%3Dx%23y");
  assert.equal(
    relativeResourcePath("/images", pathSegment("a/b"), ".png"),
    "/images/a%2Fb.png",
  );
  assert.equal(
    withQuery(navigation, {q: queryValue("<& value"), empty: queryValue("")}),
    "/things/..%2Fadmin%3Fq%3Dx%23y?q=%3C%26+value&empty=",
  );
  assert.equal(
    withQuery(navigationUrl("https://example.test/path#section"), {q: queryValue("one two")}),
    "https://example.test/path?q=one+two#section",
  );
  assert.throws(() => relativePath("/things?admin=", pathSegment("yes")), /base path/i);
  assert.throws(() => relativeResourcePath("/images", pathSegment("x"), ".png?download=1"), /suffix/i);
});

test("path segments reject dot traversal components", () => {
  for (const value of [".", ".."]) {
    assert.throws(() => pathSegment(value), /path segment/i, value);
  }
  assert.equal(pathSegment("..."), "...");
  assert.equal(pathSegment(".profile"), ".profile");
});

test("path segments keep alternate dot representations opaque", () => {
  const cases = [
    ["%2e%2e", "%252e%252e"],
    ["%2E.", "%252E."],
    ["%252e%252e", "%25252e%25252e"],
    ["%c0%ae%c0%ae", "%25c0%25ae%25c0%25ae"],
    ["&#46;&#46;", "%26%2346%3B%26%2346%3B"],
    ["&period;&period;", "%26period%3B%26period%3B"],
    ["\uff0e\uff0e", "%EF%BC%8E%EF%BC%8E"],
    ["\u2024\u2024", "%E2%80%A4%E2%80%A4"],
    ["\ufe52\ufe52", "%EF%B9%92%EF%B9%92"],
    [".\u200b.", ".%E2%80%8B."],
    ["..\0", "..%00"],
    ["\0..", "%00.."],
    ["..\r", "..%0D"],
    ["..\n", "..%0A"],
    ["../", "..%2F"],
    ["..\\", "..%5C"],
  ];

  for (const [value, encoded] of cases) {
    assert.equal(pathSegment(value), encoded, value);

    const url = relativePath("/safe/base", pathSegment(value));
    assert.equal(url, `/safe/base/${encoded}`, value);

    const parsed = new URL(url, "https://example.test");
    assert.equal(parsed.pathname, `/safe/base/${encoded}`, value);
    assert.equal(decodeURIComponent(parsed.pathname.split("/").at(-1)), value, value);
  }
});

test("path segments fail closed on text that cannot be URL-encoded", () => {
  for (const value of ["\ud800", "\udfff"]) {
    assert.throws(() => pathSegment(value), URIError, JSON.stringify(value));
  }
});
