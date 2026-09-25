import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  workers: 3,
  timeout: 15_000,
  retries: 0,
  reporter: [["json", {outputFile: new URL("../../tmp/playwright-csp/report.json", import.meta.url).pathname}]],
  outputDir: "../../tmp/playwright-csp/results",
  projects: ["chromium", "firefox", "webkit"].map((name) => ({name, use: {browserName: name}})),
});
