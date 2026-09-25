import React, {Component, useEffect} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SafeMarkdown} from 'next-xss-sbyd/markdown';
import {source} from './source.mjs';

const hydrationErrors = [];
let ready = false;
let generation = 0;

class Boundary extends Component {
  constructor(props) { super(props); this.state = {error: null}; }
  static getDerivedStateFromError(error) { return {error}; }
  render() {
    return this.state.error
      ? React.createElement('p', {id: 'failure'}, this.state.error.message)
      : this.props.children;
  }
}

function App({markdownProps}) {
  useEffect(function hydrated() { ready = true; }, []);
  return React.createElement(Boundary, {key: generation}, React.createElement(SafeMarkdown, markdownProps));
}

const root = hydrateRoot(document.getElementById('root'), React.createElement(App, {markdownProps: {children: source}}), {
  onRecoverableError(error) { hydrationErrors.push(error.message); },
});
window.markdownHarness = {
  ready() { return ready; },
  errors() { return hydrationErrors; },
  update(markdownProps) {
    generation++;
    flushSync(function update() { root.render(React.createElement(App, {markdownProps})); });
  },
};
