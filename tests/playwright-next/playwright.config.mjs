import {defineConfig} from "@playwright/test";
import {fileURLToPath} from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  workers: 3,
  timeout: 30_000,
  retries: 0,
  reporter: [["json", {outputFile: fileURLToPath(new URL("../../tmp/playwright-next/report.json", import.meta.url))}]],
  outputDir: "../../tmp/playwright-next/results",
  use: {baseURL: process.env.PLAYWRIGHT_NEXT_URL},
  projects: ["chromium", "firefox", "webkit"].map((name) => ({name, use: {browserName: name}})),
});
