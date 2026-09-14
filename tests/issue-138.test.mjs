import assert from "node:assert/strict";
import test from "node:test";
import {renderToStaticMarkup} from "react-dom/server";
import {jsx} from "next-xss-sbyd/jsx-runtime";

test("srcSet accepts commas inside an HTTP resource URL", () => {
  const srcSet = "https://res.cloudinary.com/demo/image/upload/w_100,h_100/sample.jpg 1x";
  const markup = renderToStaticMarkup(jsx("img", {srcSet, alt: ""}));
  assert.ok(markup.includes(`srcSet="${srcSet}"`), markup);
});
