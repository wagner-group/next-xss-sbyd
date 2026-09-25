import {
  createPassiveObjectUrl, revokePassiveObjectUrl,
  attachPassiveObjectUrlPreview, attachPassiveObjectUrlDownload,
  PassiveObjectUrlPreview, PassiveObjectUrlDownload,
} from 'next-xss-sbyd/object-url';
import type {PassiveObjectUrl} from 'next-xss-sbyd/object-url';

const blob = new Blob(['bytes'], {type:'image/png'});
const handle = createPassiveObjectUrl(blob, 'raster-preview');
attachPassiveObjectUrlPreview(document.createElement('img'), handle);
attachPassiveObjectUrlDownload(document.createElement('a'), createPassiveObjectUrl(blob, 'download'), 'picture.png');
revokePassiveObjectUrl(handle);
<PassiveObjectUrlPreview blob={blob} alt="Preview" />;
<PassiveObjectUrlDownload blob={blob} filename="picture.png">Download</PassiveObjectUrlDownload>;
// @ts-expect-error Handles cannot be manufactured from public metadata.
const forged: PassiveObjectUrl = {url:'blob:foreign', mediaType:'image/png', use:'download', revoked:false};
// @ts-expect-error MediaSource needs a separately reviewed native exception.
createPassiveObjectUrl(new MediaSource(), 'download');
// @ts-expect-error No active-resource use permission.
createPassiveObjectUrl(blob, 'script');
// @ts-expect-error Metadata is immutable.
handle.revoked = false;
// @ts-expect-error A raw URL is not a capability.
attachPassiveObjectUrlPreview(document.createElement('img'), handle.url);
// @ts-expect-error No iframe adapter.
attachPassiveObjectUrlPreview(document.createElement('iframe'), handle);
// @ts-expect-error URL and arbitrary DOM props cannot override the checked adapter.
<PassiveObjectUrlPreview blob={blob} alt="Preview" src="blob:foreign" />;
// @ts-expect-error Download links require filenames.
<PassiveObjectUrlDownload blob={blob}>Download</PassiveObjectUrlDownload>;

// @ts-expect-error Every capability requires an explicit intended use.
createPassiveObjectUrl(blob);
