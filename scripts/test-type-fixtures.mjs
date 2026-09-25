import {spawnSync} from "node:child_process";

function run(args) {
  return spawnSync(process.execPath, args, {encoding: "utf8"});
}

const tsc = "node_modules/typescript/bin/tsc";
const passing = run([tsc, "-p", "type-fixtures/tsconfig.json"]);
if (passing.status !== 0) {
  process.stderr.write(passing.stdout + passing.stderr);
  throw new Error("Compile-pass fixture failed");
}

const failing = run([
  tsc,
  "--ignoreConfig",
  "--noEmit",
  "--strict",
  "--target", "ES2022",
  "--module", "NodeNext",
  "--moduleResolution", "NodeNext",
  "type-fixtures/fail/raw-safe-values.ts",
]);
if (failing.status === 0) {
  throw new Error("Compile-fail fixture unexpectedly compiled");
}
const diagnostics = failing.stdout + failing.stderr;
for (const type of [
  "SafeHtml",
  "SafeScript",
  "SafeStyleSheet",
  "TrustedResourceUrl",
]) {
  if (!diagnostics.includes(type)) {
    throw new Error(`Compile-fail fixture did not reject ${type}`);
  }
}
if (!diagnostics.includes("Type 'string | null' is not assignable to type 'string'")) {
  throw new Error("Compile-fail fixture did not reject unchecked nullable URLs");
}
if (!diagnostics.includes("configureJsxGuard")) {
  throw new Error("Compile-fail fixture did not reject the removed JSX guard configuration API");
}
console.log("Compile-pass and compile-fail contracts behaved as expected.");
