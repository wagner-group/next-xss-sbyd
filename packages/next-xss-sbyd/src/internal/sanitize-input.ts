/** Checks the public contract before any engine processing or coercion. */
export function checkSanitizerInput(dirty: string, argumentCount: number): void {
  if (typeof dirty !== "string") throw new TypeError("sanitizeUserHtml requires a string");
  if (argumentCount !== 1) throw new TypeError("sanitizeUserHtml accepts exactly one argument; policies/options are unsupported; call sanitizeUserHtml(dirty) directly; do not pass it as a callback to map/forEach");
}
