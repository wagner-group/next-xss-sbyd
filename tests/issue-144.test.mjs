import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
const workspace = fileURLToPath(new URL("../", import.meta.url));
test("CSP suggestion CLI reads normalized reports from stdin", () => {
  const result = spawnSync(process.execPath, [join(workspace, "packages/next-xss-sbyd/dist/csp-suggest.js")], {encoding: "utf8", cwd: workspace, input: "[]"});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {});
});
