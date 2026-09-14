import assert from "node:assert/strict";
import {once} from "node:events";
import {access} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {renderToStaticMarkup} from "react-dom/server";
import {SafeIframe, trustedResourceUrl} from "next-xss-sbyd";
import {jsx} from "next-xss-sbyd/jsx-runtime";

// A real, deterministic one-page PDF with a cross-reference table and visible text.
function onePagePdf() {
  const stream = "BT /F1 24 Tf 30 100 Td (Native PDF compatibility) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function verifyViewer(page) {
  // One decoded page count is sufficient. Chrome's extension internals can change;
  // do not additionally require unrelated toolbar and load-state implementation fields.
  let sawViewerFrame = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith("chrome-extension://")) continue;
      sawViewerFrame = true;
      try {
        const pages = await frame.evaluate(() =>
          document.querySelector("pdf-viewer")?.documentDimensions?.pageDimensions?.length,
        );
        if (pages === 1) return;
      } catch {
        // The viewer may replace/detach its extension frame during initialization.
        // Poll the current frames again instead of failing on that navigation race.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(sawViewerFrame
    ? "Native PDF extension frame appeared but did not report one decoded page within 10 s; inspect the PDF and Chrome's viewer internals before updating this probe"
    : "No native PDF chrome-extension:// frame appeared within 10 s; use full Chrome/Chromium with PDF support (not headless shell), or investigate changed browser behavior");
}

/** Exercises native PDF rendering and response sandboxing over real HTTP in Chrome. */
export async function verifyNativePdf(browser) {
  const pdf = onePagePdf();
  // Unsandboxed frames are browser diagnostic controls only, not an application
  // component or a supported replacement for SafeIframe (issue #185, scope 4).
  const cases = [
    {name: "native", src: trustedResourceUrl`/document.pdf`},
    {name: "empty", src: trustedResourceUrl`/document.pdf`, sandbox: ""},
    {name: "scripts", src: trustedResourceUrl`/document.pdf`, sandbox: "allow-scripts"},
    // Owner-approved #185 scope item 4 requires evidence that an HTML error/fallback
    // cannot execute under response sandboxing, with an executable positive control.
    // These diagnostic cases do not endorse an unsandboxed iframe application recipe.
    {name: "html-control", src: trustedResourceUrl`/control.html`},
    {name: "html-sandbox", src: trustedResourceUrl`/fallback.html`},
  ];
  const documents = new Map(cases.map(({name, src, sandbox}) => [
    `/${name}`,
    renderToStaticMarkup(jsx(sandbox === undefined ? "iframe" : SafeIframe, {
      src, ...(sandbox === undefined ? {} : {sandbox}), title: name,
    })),
  ]));
  const server = createServer((request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (documents.has(request.url)) {
      response.setHeader("Content-Type", "text/html");
      response.setHeader("Content-Security-Policy", "frame-src 'self'; object-src 'none'");
      response.end(documents.get(request.url));
    } else if (request.url === "/document.pdf") {
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader("Content-Disposition", "inline");
      response.end(pdf);
    } else if (request.url === "/control.html" || request.url === "/fallback.html") {
      response.setHeader("Content-Type", "text/html");
      if (request.url === "/fallback.html") response.setHeader("Content-Security-Policy", "sandbox");
      response.end('<!doctype html><p>HTML fallback</p><script>globalThis.__PDF_SCRIPT__ = true; parent.__PDF_SCRIPT__ = true;</script>');
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  try {
    for (const {name, sandbox} of cases) {
      const page = await context.newPage();
      await page.goto(`${origin}/${name}`, {waitUntil: "load"});
      if (name.startsWith("html-")) {
        const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
        assert.equal(await frame.locator("p").textContent(), "HTML fallback");
        const expected = name === "html-control";
        assert.equal(await frame.evaluate(() => globalThis.__PDF_SCRIPT__ === true), expected, `${name}: frame script execution`);
        assert.equal(await page.evaluate(() => globalThis.__PDF_SCRIPT__ === true), expected, `${name}: parent script execution`);
      } else if (sandbox !== undefined) {
        assert.equal(await page.locator("iframe").getAttribute("sandbox"), sandbox);
        if (!page.frames().some((frame) => frame.url() === "chrome-error://chromewebdata/")) {
          await verifyViewer(page);
          assert.fail(`Chrome now renders native PDFs under sandbox=${JSON.stringify(sandbox)}; update docs/caveats.md#native-pdf-viewing and this fixture to reflect the browser improvement`);
        }
      } else {
        await verifyViewer(page);
      }
      await page.close();
    }
    console.log(`Native PDF compatibility passed (${browser.version()}): one-page viewer, supported sandbox failures, HTML fallback protection.`);
  } finally {
    await context.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

/** Finds full Chrome/Chromium for native-PDF and Next compatibility checks. */
export async function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next platform-specific location.
    }
  }
  throw new Error("Full Chrome/Chromium was not found; set CHROME_PATH to a build with native PDF support (not headless shell)");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await chromium.launch({headless: true, executablePath: await chromePath()});
  try {
    await verifyNativePdf(browser);
  } finally {
    await browser.close();
  }
}
