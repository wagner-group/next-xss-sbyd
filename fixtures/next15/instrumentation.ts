/** Installs the Node response guard through Next's production startup hook. */
export async function register() {
  // TEST ONLY: do not copy this environment-variable bypass into applications.
  // The compatibility runner uses it only for the disabled-hook negative control.
  // Production applications must install unconditionally when NEXT_RUNTIME is nodejs.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_XSS_SBYD_SKIP_INSTRUMENTATION !== "1") {
    (await import("next-xss-sbyd/enforce")).installResponseGuard();
  }
}
