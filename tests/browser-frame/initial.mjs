export const initialProps = {
  value: '<h1>Readable content</h1><p><strong>Safe formatting</strong></p><img src="/assets/pixel.png" alt="Blue pixel"><audio src="/assets/tone.wav"></audio><video src="/assets/clip.webm" poster="/assets/pixel.png"></video><a href="/destination" target="_top">Read more</a><img src="relative.png">',
  title: 'Sanitized document',
  id: 'document-frame',
  className: 'document',
  width: 400,
  height: 250,
  loading: 'eager',
  tabIndex: 0,
  role: 'document',
  'aria-label': 'Article',
  'aria-describedby': 'description',
  'aria-labelledby': 'label',
};
