// Port of thumbpinclient/src/lib/remotion/caption-presets.js — style presets
// for the VEED subtitles API (fal.ai `veed/subtitles`). "dynamic" presets
// render animated captions and cost 2x vs "basic" presets (see
// computeCaptionCreditCost). Kept in sync manually with the frontend copy,
// which still owns rendering the picker UI in the editor's caption panel.
export interface CaptionPreset {
  id: string;
  label: string;
  tier: 'dynamic' | 'basic';
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: 'glass', label: 'Glass', tier: 'dynamic' },
  { id: 'whisper', label: 'Whisper', tier: 'dynamic' },
  { id: 'glide', label: 'Glide', tier: 'dynamic' },
  { id: 'glide2', label: 'Glide 2', tier: 'dynamic' },
  { id: 'fusion', label: 'Fusion', tier: 'dynamic' },
  { id: 'terminal', label: 'Terminal', tier: 'dynamic' },
  { id: 'handwritten', label: 'Handwritten', tier: 'dynamic' },
  { id: 'backdrop', label: 'Backdrop', tier: 'dynamic' },
  { id: 'backdrop2', label: 'Backdrop 2', tier: 'dynamic' },
  { id: 'simple', label: 'Simple', tier: 'basic' },
  { id: 'plain', label: 'Plain', tier: 'basic' },
  { id: 'beans', label: 'Beans', tier: 'basic' },
  { id: 'corpo', label: 'Corpo', tier: 'basic' },
  { id: 'boo', label: 'Boo', tier: 'basic' },
  { id: 'shadeplay', label: 'Shadeplay', tier: 'basic' },
  { id: 'casper', label: 'Casper', tier: 'basic' },
  { id: 'capri', label: 'Capri', tier: 'basic' },
  { id: 'lowkey', label: 'Lowkey', tier: 'basic' },
  { id: 'vinta', label: 'Vinta', tier: 'basic' },
  { id: 'diego', label: 'Diego', tier: 'basic' },
  { id: 'ali', label: 'Ali', tier: 'basic' },
  { id: 'slay', label: 'Slay', tier: 'basic' },
  { id: 'kitty', label: 'Kitty', tier: 'basic' },
  { id: 'hustle', label: 'Hustle', tier: 'basic' },
  { id: 'karl', label: 'Karl', tier: 'basic' },
  { id: 'sprout', label: 'Sprout', tier: 'basic' },
  { id: 'flex', label: 'Flex', tier: 'basic' },
  { id: 'mint', label: 'Mint', tier: 'basic' },
  { id: 'rizz', label: 'Rizz', tier: 'basic' },
  { id: 'vegas', label: 'Vegas', tier: 'basic' },
];
