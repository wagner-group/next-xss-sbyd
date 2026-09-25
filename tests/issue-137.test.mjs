import assert from "node:assert/strict";
import test from "node:test";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeImage} from "next-xss-sbyd";
import {jsx} from "next-xss-sbyd/jsx-runtime";

test("SafeImage validates overrideSrc before Next forwards it", () => {
  assert.throws(() => renderToStaticMarkup(jsx(SafeImage, {
    src: "/safe.png", overrideSrc: "//evil.example/tracker.png", alt: "",
    width: 16, height: 16, unoptimized: true,
  })), /Invalid URL/u);
});
