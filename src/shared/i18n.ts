/**
 * Localised text matchers for Google Maps UI strings. Only English is verified so far; add a
 * language once you've checked it in a real Maps session. Everything falls back to structural
 * detection when no matcher hits.
 */
export const IMAGE_CAPTURE_LABELS: Record<string, string[]> = {
  // Verified: 2026-11 (en-US)
  en: ['Image capture'],
};

/** All known prefixes, longest first. */
export function imageCapturePrefixes(): string[] {
  return Object.values(IMAGE_CAPTURE_LABELS)
    .flat()
    .sort((a, b) => b.length - a.length);
}

/** Does `text` look like "Image capture: Jun 2023"? */
export function isImageCaptureText(text: string): boolean {
  const t = text.trim();
  return imageCapturePrefixes().some((p) => t.startsWith(p));
}

/** The "Saved" nav-rail item. Verified: 2026-11-13 (en-US). */
export const SAVED_LABELS: Record<string, string[]> = {
  en: ['Saved'],
};

export function isSavedText(text: string): boolean {
  const t = text.trim();
  return Object.values(SAVED_LABELS).some((l) => l.includes(t));
}
