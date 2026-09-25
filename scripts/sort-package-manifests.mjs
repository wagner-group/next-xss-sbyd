import {readFileSync, writeFileSync} from "node:fs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  console.error("Usage: node scripts/sort-package-manifests.mjs [--check]");
  process.exit(1);
}
const check = args[0] === "--check";
const fields = ["scripts", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta"];

for (const path of ["package.json", "packages/next-xss-sbyd/package.json"]) {
  const original = readFileSync(path, "utf8");
  const manifest = JSON.parse(original);
  for (const field of [...fields, "exports"]) {
    const value = manifest[field];
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const keys = Object.keys(value);
    // Node evaluates conditions in insertion order, including nested conditions.
    // Only the outer subpath map can be alphabetized without changing selection.
    if (field === "exports" && !keys.every(key => key === "." || key.startsWith("./"))) continue;
    manifest[field] = Object.fromEntries(keys.sort().map(key => [key, value[key]]));
  }
  const formatted = JSON.stringify(manifest, null, 2) + "\n";
  if (original === formatted) continue;
  if (check) {
    console.error(`${path}: manifest ordering/formatting differs; run npm run format:manifests`);
    process.exitCode = 1;
  } else {
    writeFileSync(path, formatted);
  }
}
