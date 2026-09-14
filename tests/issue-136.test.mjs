import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("the sanitizer is isolated from shared DOMPurify configuration", async () => {
  const program = `
    import {JSDOM} from "jsdom";
    globalThis.window = new JSDOM("<!doctype html>").window;
    const {default: DOMPurify} = await import("dompurify");
    DOMPurify.addHook("afterSanitizeAttributes", function addUnsafeFrame(node) {
      if (node.localName === "p") node.appendChild(window.document.createElement("iframe"));
    });
    const {sanitizeUserHtml} = await import("next-xss-sbyd/sanitize-node");
    import {SafeResponse} from "next-xss-sbyd";
    DOMPurify.setConfig({ADD_TAGS: ["iframe"], RETURN_DOM: true});
    const html = sanitizeUserHtml('<p>safe</p><iframe src="https://evil.example/"></iframe><img src="/tracker.png">');
    process.stdout.write(await new SafeResponse(html).text());
  `;
  const {stdout} = await execFileAsync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: new URL("../", import.meta.url),
  });
  assert.equal(stdout, '<p>safe</p><img src="/tracker.png" referrerpolicy="no-referrer">');
});
