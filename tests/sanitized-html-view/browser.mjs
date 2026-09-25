import {Component, createElement, createRef} from "react";
import {createRoot, hydrateRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {SanitizedHtmlView} from "next-xss-sbyd/sanitized-html-view";

class ErrorBoundary extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error: error.message}; }
  render() {
    return this.state.error === null ? this.props.children : createElement("p", {id: "failure"}, this.state.error);
  }
}

const ref = createRef();
const boundary = createRef();
let boundaryKey = 0;
const errors = [];
let callbackNode;
function receiveNode(node) { callbackNode = node; }
function view(props, callback = false) {
  return createElement(ErrorBoundary, {key: boundaryKey, ref: boundary},
    createElement(SanitizedHtmlView, {...props, ref: callback ? receiveNode : ref}));
}
const initial = {as: "article", value: '<b>bold</b><em>emphasis</em><script>window.attacked=true</script><a href="javascript:alert(1)">link</a>', id: "content", className: "prose"};
const container = document.getElementById("root");
const root = location.pathname === "/engine-failure" ? createRoot(container) : hydrateRoot(container, view(initial), {
  onRecoverableError(error) { errors.push(error.message); },
});
if (location.pathname === "/engine-failure") flushSync(() => root.render(view(initial)));
window.viewHarness = {
  errors,
  ready() { return ref.current !== null; },
  render(props, callback = false) {
    const previousNode = callback ? callbackNode : ref.current;
    // Reset only failed boundaries, so ordinary content updates exercise one instance.
    if (boundary.current.state.error !== null) boundaryKey++;
    flushSync(() => root.render(view(props, callback)));
    return previousNode !== null && previousNode === (callback ? callbackNode : ref.current);
  },
  inspect(callback = false) {
    const node = callback ? callbackNode : ref.current;
    const markup = node.outerHTML;
    node.scrollIntoView();
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return {tag: node.localName, html: node.innerHTML, selected: selection.toString(), sameMarkup: markup === node.outerHTML, connected: node.isConnected};
  },
  unmount() { flushSync(() => root.unmount()); return {object: ref.current, callback: callbackNode}; },
};
