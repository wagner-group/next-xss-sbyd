import React, {Component, createRef} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SanitizedHtmlFrame} from 'next-xss-sbyd/sanitized-html-frame';
import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';
import {initialProps} from './initial.mjs';

const objectRef = createRef();
const callbackValues = [];
const hydrationErrors = [];
let cleanups = 0;
let currentProps = initialProps;
let currentRef = objectRef;
let generation = 0;

function callbackRef(node) { callbackValues.push(node); }
function cleanupRef(node) {
  callbackValues.push(node);
  return function cleanup() { cleanups++; };
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = {error: null}; }
  static getDerivedStateFromError(error) { return {error}; }
  render() {
    if (this.state.error) return React.createElement('p', {id: 'failure'}, this.state.error.message);
    return this.props.children;
  }
}

function tree() {
  return React.createElement(Boundary, {key: generation}, React.createElement(SanitizedHtmlFrame, {...currentProps, ref: currentRef}));
}

const root = hydrateRoot(document.getElementById('root'), tree(), {
  onRecoverableError(error) { hydrationErrors.push(error.message); },
});

window.frameHarness = {
  sanitizeOnly(value) { sanitizeUserHtml(value); },
  ready() { return objectRef.current instanceof HTMLIFrameElement; },
  status() {
    return {
      hydrationErrors,
      cleanups,
      reactMajor: Number(React.version.split('.')[0]),
      objectRef: objectRef.current === document.querySelector('iframe'),
      callbackValues: callbackValues.map(node => node === null ? null : node.tagName),
      callbackCurrent: callbackValues.at(-1) === document.querySelector('iframe'),
    };
  },
  update(props, ref = 'object', reset = false) {
    currentProps = props;
    currentRef = ref === 'object' ? objectRef : ref === 'callback' ? callbackRef : ref === 'cleanup' ? cleanupRef : null;
    if (reset) generation++;
    flushSync(function renderUpdate() { root.render(tree()); });
  },
  unmount() { flushSync(function remove() { root.unmount(); }); },
};
