"use client";

import {useMemo, useState} from "react";
import {SafeBlock} from "next-xss-sbyd";
import type {SafeHtml} from "next-xss-sbyd";
import {sanitizeUserHtml} from "next-xss-sbyd/sanitize";

/** Displays strings through the universal sanitizer without restricted conversions. */
export default function SanitizedArticle({dirty}: {dirty: string}) {
  const initial = useMemo(() => sanitizeUserHtml(dirty), [dirty]);
  const [preview, setPreview] = useState<SafeHtml | null>(null);
  function updatePreview(value: string) {
    setPreview(sanitizeUserHtml(value));
  }
  return <>
    <textarea onChange={event => updatePreview(event.currentTarget.value)} />
    <SafeBlock html={preview ?? initial} />
  </>;
}
