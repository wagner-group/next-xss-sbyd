import {sanitizeUserHtml} from 'next-xss-sbyd/sanitize';
self.onmessage = () => {
  try {
    sanitizeUserHtml('<script>postMessage("executed")</script>');
    self.postMessage({rejected: false});
  } catch (error) {
    self.postMessage({rejected: true, message: error.message});
  }
};
