import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import test from "node:test";

// Importing react-markdown under this condition fails because React Server
// Components do not expose its useEffect/useState imports. Exercise the public
// entry point in a fresh process using the actual React server export.
test("SafeMarkdown renders synchronously under the react-server condition", () => {
  const result = spawnSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import * as React from "react";
    import {SafeMarkdown} from "next-xss-sbyd/markdown";
    assert.equal(React.useState, undefined);
    const output = SafeMarkdown({children: "# Server heading"});
    assert(React.isValidElement(output));
    const heading = output.props.children;
    assert.equal(heading.type, "h1");
    assert.equal(heading.props.children, "Server heading");
    assert.throws(() => SafeMarkdown({children: "x".repeat(32769)}), RangeError);
  `], {encoding: "utf8", timeout: 10000});
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
