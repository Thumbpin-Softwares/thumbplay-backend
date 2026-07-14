// Verbatim port of thumbpinclient/src/lib/remotion/overlay-fonts.js. Kept to
// common web-safe stacks (no @remotion/google-fonts) so preview (browser
// fonts, in the out-of-scope editor) and server render (headless Chromium
// fonts) never drift for a font name that isn't actually installed there.

export interface OverlayFont {
  id: string;
  label: string;
  css: string;
}

export const OVERLAY_FONTS: OverlayFont[] = [
  { id: 'sans', label: 'Sans', css: "'Arial', 'Helvetica', sans-serif" },
  { id: 'serif', label: 'Serif', css: "'Georgia', 'Times New Roman', serif" },
  { id: 'mono', label: 'Mono', css: "'Courier New', monospace" },
  { id: 'trebuchet', label: 'Trebuchet', css: "'Trebuchet MS', sans-serif" },
  { id: 'verdana', label: 'Verdana', css: "'Verdana', sans-serif" },
  { id: 'impact', label: 'Impact', css: "'Impact', 'Arial Narrow', sans-serif" },
  { id: 'comic', label: 'Comic', css: "'Comic Sans MS', cursive" },
];

export function getOverlayFontCss(id: string | undefined): string {
  return OVERLAY_FONTS.find((f) => f.id === id)?.css || OVERLAY_FONTS[0]!.css;
}

// opacityPercent is 0-100. Returns "transparent" at 0 so callers can skip
// padding/background entirely without a separate "enabled" flag.
export function hexToRgba(hex: string | undefined, opacityPercent = 0): string {
  if (!opacityPercent) return 'transparent';
  const clean = (hex || '#000000').replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(100, Math.max(0, opacityPercent)) / 100})`;
}
