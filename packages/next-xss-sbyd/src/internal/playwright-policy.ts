type Policy = Map<string, readonly string[]>;

const ASCII_WHITESPACE = /[\t\n\f\r ]+/;
const EDGE_WHITESPACE = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;
const NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/i;
const UNSAFE_SCRIPT_KEYWORDS = new Set(["'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]);

function parsePolicies(headers: readonly { name: string; value: string }[]): Policy[] {
  const policies: Policy[] = [];
  for (const header of headers) {
    if (header.name.toLowerCase() !== "content-security-policy") continue;
    // Commas separate policies, including when intermediaries combine fields.
    for (const serialized of header.value.split(",")) {
      const policy: Policy = new Map();
      for (const directive of serialized.split(";")) {
        // CSP discards an entire directive containing non-ASCII code points.
        if (/[^\x00-\x7F]/.test(directive)) continue;
        const tokens = directive.replace(EDGE_WHITESPACE, "").split(ASCII_WHITESPACE);
        const name = tokens[0].toLowerCase();
        if (name && !policy.has(name)) policy.set(name, tokens.slice(1));
      }
      if (policy.size > 0) policies.push(policy);
    }
  }
  return policies;
}

function nonceSources(sources: readonly string[]): string[] {
  const nonces: string[] = [];
  for (const source of sources) {
    const match = NONCE_SOURCE.exec(source);
    if (match) nonces.push(match[1]);
  }
  return nonces;
}

function strictScriptNonce(sources: readonly string[] | undefined, directive: string): string {
  if (!sources) throw new Error(`An explicit ${directive} directive is required`);
  const nonces = nonceSources(sources);
  if (nonces.length !== 1) {
    throw new Error(`${directive} must contain exactly one valid, nonempty nonce source`);
  }
  const keywords = sources.map((source) => source.toLowerCase());
  if (!keywords.includes("'strict-dynamic'")) {
    throw new Error(`${directive} must contain 'strict-dynamic'`);
  }
  if (keywords.some((source) => UNSAFE_SCRIPT_KEYWORDS.has(source))) {
    throw new Error(`${directive} contains an unsupported unsafe script keyword`);
  }
  return nonces[0];
}

function isSingleKeyword(sources: readonly string[] | undefined, keywords: readonly string[]): boolean {
  return sources?.length === 1 && keywords.includes(sources[0].toLowerCase());
}

function strictPolicyNonce(policy: Policy): string {
  const nonce = strictScriptNonce(policy.get("script-src"), "script-src");
  if (!isSingleKeyword(policy.get("object-src"), ["'none'"])) {
    throw new Error("object-src must be exactly 'none'");
  }
  if (!isSingleKeyword(policy.get("base-uri"), ["'self'", "'none'"])) {
    throw new Error("base-uri must be exactly 'self' or 'none'");
  }
  const elements = policy.get("script-src-elem");
  if (elements && strictScriptNonce(elements, "script-src-elem") !== nonce) {
    throw new Error("Unsupported script-src-elem override: its nonce must match script-src");
  }
  const attributes = policy.get("script-src-attr");
  if (attributes && !isSingleKeyword(attributes, ["'none'"])) {
    throw new Error("Unsupported script-src-attr override: it must be exactly 'none'");
  }
  return nonce;
}

/** Validates enforcing response policies and selected scripts without exposing policy secrets in errors. */
export function assertScriptPolicy(
  headers: readonly { name: string; value: string }[],
  scripts: readonly { isScript: boolean; nonce: string }[],
): string {
  const policies = parsePolicies(headers);
  if (policies.length === 0) {
    throw new Error("Nonce policy assertion requires an enforcing Content-Security-Policy response header");
  }
  if (scripts.length === 0) throw new Error("The script selector did not match any elements");
  if (scripts.some((script) => !script.isScript)) {
    throw new Error("Every selected element must be an HTMLScriptElement");
  }

  const profileFailures: string[] = [];
  let nonce: string | undefined;
  for (const [index, policy] of policies.entries()) {
    try {
      const candidate = strictPolicyNonce(policy);
      if (scripts.every((script) => script.nonce === candidate)) {
        nonce = candidate;
        break;
      }
      profileFailures.push(`Policy ${index + 1}: selected script nonce does not match the strict policy`);
    } catch (error) {
      // All messages originate in the fixed profile checks above, never raw headers.
      profileFailures.push(`Policy ${index + 1}: ${(error as Error).message}`);
    }
  }
  if (nonce === undefined) {
    throw new Error(`No enforcing policy satisfies the strict nonce profile. ${profileFailures.join("; ")}`);
  }

  for (const [index, policy] of policies.entries()) {
    const sources = policy.get("script-src-elem") ?? policy.get("script-src") ?? policy.get("default-src");
    if (!sources || !nonceSources(sources).includes(nonce)) {
      throw new Error(
        `Enforcing policy ${index + 1} has an unsupported script-element source list: the selected nonce must be explicitly permitted; hash-only, URL-only, and absent source lists are unsupported`,
      );
    }
    const sandbox = policy.get("sandbox");
    if (sandbox && !sandbox.some((token) => token.toLowerCase() === "allow-scripts")) {
      throw new Error(`Enforcing policy ${index + 1} has a sandbox directive that blocks scripts`);
    }
  }
  return nonce;
}
