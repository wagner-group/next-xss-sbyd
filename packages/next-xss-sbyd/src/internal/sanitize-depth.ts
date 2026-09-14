import {defaultTreeAdapter, parse} from "parse5";
import type {DefaultTreeAdapterTypes} from "parse5";

const MAX_HTML_ELEMENT_DEPTH = 512;

function checkDepth(depth: number): void {
  if (depth > MAX_HTML_ELEMENT_DEPTH) {
    throw new TypeError(`sanitizeUserHtml input exceeds the maximum HTML element depth of ${MAX_HTML_ELEMENT_DEPTH}`);
  }
}

/** Rejects deeply nested HTML before JSDOM constructs or serializes its DOM. */
export function checkSanitizerDepth(dirty: string): void {
  // Correctness assumes this package and JSDOM resolve the same parse5; tests verify it.
  // Match DOMPurify's HTML DOMParser: a full document with scripting disabled.
  // The default adapter builds plain objects, avoiding JSDOM's recursive work.
  const treeAdapter = {
    ...defaultTreeAdapter,
    openElementDepth: 0,
    onItemPush() {
      checkDepth(++this.openElementDepth);
    },
    onItemPop() {
      this.openElementDepth--;
    },
  };
  // Stop during parsing too: a later frameset can discard a deeply nested body.
  const document = parse(dirty, {scriptingEnabled: false, treeAdapter});
  // Void leaves are not pushed onto the open stack; also check reparented tree depth.
  const stack: {node: DefaultTreeAdapterTypes.Node; depth: number}[] = [{node: document, depth: 0}];
  while (stack.length > 0) {
    const {node, depth} = stack.pop()!;
    const elementDepth = depth + ("tagName" in node ? 1 : 0);
    checkDepth(elementDepth);
    if ("childNodes" in node) {
      for (const child of node.childNodes) stack.push({node: child, depth: elementDepth});
    }
    // Template descendants live in a separate fragment, not in childNodes.
    if ("content" in node) stack.push({node: node.content, depth: elementDepth});
  }
}
