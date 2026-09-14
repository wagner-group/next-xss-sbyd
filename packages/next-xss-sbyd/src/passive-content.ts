// Explicit document-response policy. See docs/passive-content.md for sources and limits.
/** Exact accepted MIME essences, frozen for tooling and policy verification. */
export const PASSIVE_MEDIA_TYPES: readonly string[] = Object.freeze([
  "text/calendar", "image/tiff", "application/vnd.apple.mpegurl", "audio/mpegurl", "application/x-mpegurl", "audio/x-mpegurl",
  "text/plain", "text/csv", "text/tab-separated-values", "text/event-stream", "text/vtt", "text/markdown",
  "application/json", "application/x-ndjson", "application/ndjson", "application/octet-stream",
  "application/x-www-form-urlencoded", "multipart/form-data", "application/wasm",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/apng", "image/bmp",
  "image/x-icon", "image/vnd.microsoft.icon",
  "audio/aac", "audio/aiff", "audio/flac", "audio/midi", "audio/mp4", "audio/mpeg", "audio/ogg",
  "audio/wav", "audio/wave", "audio/webm", "audio/x-aiff", "audio/x-flac", "audio/x-midi", "audio/x-wav",
  "video/mp4", "video/mpeg", "video/ogg", "video/quicktime", "video/webm", "video/x-msvideo", "application/ogg",
  "font/collection", "font/otf", "font/sfnt", "font/ttf", "font/woff", "font/woff2",
  "application/font-cff", "application/font-otf", "application/font-sfnt", "application/font-ttf",
  "application/font-woff", "application/vnd.ms-fontobject", "application/vnd.ms-opentype",
  "application/zip", "application/gzip", "application/x-gzip", "application/x-tar",
  "application/x-7z-compressed", "application/vnd.rar", "application/x-rar-compressed",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const passiveMediaTypes = new Set(PASSIVE_MEDIA_TYPES);

const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const JSON_MEDIA_TYPE = new RegExp(`^application/${TOKEN}\\+json$`, "iu");
const QUOTED_VALUE = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t -~])*"';
const MEDIA_TYPE = new RegExp(`^${TOKEN}\/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|${QUOTED_VALUE}))*[ \\t]*$`, "u");

/** Returns a lowercase MIME essence for a strictly valid header, or null on invalid input. */
export function parsedMediaType(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!MEDIA_TYPE.test(normalized)) return null;
  return normalized.split(";", 1)[0].trim().toLowerCase();
}

/** Reports whether a syntactically valid Content-Type uses the passive response policy. */
export function isPassiveMediaType(value: string | null | undefined): boolean {
  const mediaType = parsedMediaType(value);
  if (mediaType !== null && passiveMediaTypes.has(mediaType)) return true;
  return mediaType !== null && JSON_MEDIA_TYPE.test(mediaType);
}

/** Rejects missing, malformed and non-allowlisted effective media types. */
export function assertPassiveContentType(contentType: string | null | undefined, subject = "Raw string response"): void {
  if (!isPassiveMediaType(contentType)) {
    throw new TypeError(`${subject} requires an allowlisted passive Content-Type; received ${contentType ?? "no Content-Type"}`);
  }
}
