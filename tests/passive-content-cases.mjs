// Independent expected HTTP policy, also exercised by the browser probe.
export const passiveTypes = [
  "text/calendar", "image/tiff", "application/vnd.apple.mpegurl", "audio/mpegurl", "application/x-mpegurl", "audio/x-mpegurl",
  "text/plain", "text/csv", "text/tab-separated-values", "text/event-stream", "text/vtt", "text/markdown",
  "application/json", "application/problem+json", "application/x-ndjson", "application/ndjson", "application/octet-stream",
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
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const rejectedTypes = [
  "application/rss+xml", "application/atom+xml", "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml",
  "audio/example+xml", "video/example+xml", "font/example+xml", "image/example+xml",
  "text/javascript", "application/javascript", "text/css", "application/pdf", "text/pdf",
  "multipart/x-mixed-replace", "multipart/related", "multipart/mixed", "multipart/byteranges", "message/rfc822", "application/x-shockwave-flash",
  "audio/unknown", "video/unknown", "font/unknown", "image/unknown", "application/example+zip",
  "application/+json", "application/unknown", "unknown/unknown", "*/*", "",
  "image/png, text/html", "image/png;", "image/png; charset", 'image/png; charset="unterminated',
];
