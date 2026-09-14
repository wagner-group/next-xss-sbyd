import React from 'react';
import {createRoot} from 'react-dom/client';
import {SafeBlock} from 'next-xss-sbyd';
import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';
window.renderBaseline = html => createRoot(document.getElementById('root')).render(React.createElement(SafeBlock, {html: sanitizeUserHtml(html)}));
