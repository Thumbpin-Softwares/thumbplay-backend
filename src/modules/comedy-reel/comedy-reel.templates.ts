import { splitWordsIntoChunks } from '../reel/template-reproduce.service';

// Verbatim port of the "Nosy Padosi" (nosy neighbor) master templates from
// thumbpinclient/src/app/api/comedy-reel/generate-pipeline/route.js. Part 1
// has a whisper+shout 3-beat dialogue plus a non-dialogue "shhh" gesture
// (parenthetical) — buildReproducePrompt below is modified accordingly to
// tell the LLM not to overwrite the gesture with spoken lines.

export const MASTER_TEMPLATE_A = `A hyper-realistic, vertical (9:16) UGC-style comedy real estate vlog. Natural lighting.

[0:00 - 0:06] The video opens with the female agent, Anvi (using #image7 and #image5), peeking out suspiciously from behind a wooden door, looking left and right as if she is hiding from someone. She holds the camera selfie-style close to her face and whispers dramatically: "Kya aap bhi apne padosiyon ki taak-jhaak se pareshan hain?" Then she steps out confidently, her tone changing to a loud, energetic pitch: "Tension mat lijiye! Main hoon Anvi..."

[0:06 - 0:09] Hard cut. A fast drone-style push-in shot of the luxury villa exterior, matching #image1.

[0:09 - 0:12] Hard cut. A slow pan across the stunning, high-ceiling luxury loft space, matching #image3.

[0:12 - 0:15] Hard cut. Back to Anvi (#image7 and #image5). She winks at the camera selfie-style and finishes: "...aur aaj main aapko dikhaungi ek aisi private luxury property, jahan koi disturbance nahi!" (She smiles and puts a finger to her lips in a "shhh" gesture for the last 2 seconds).`;

export const MASTER_TEMPLATE_B = `A hyper-realistic, vertical (9:16) UGC-style comedy real estate vlog. Natural interior lighting, dynamic fast-paced editing.

[0:00 - 0:03] The video opens with a fast, FPV drone-style sweeping shot moving towards the gated entrance of the luxury villa, matching exactly with #image1. The voiceover starts: "Yahaan koi padosi nahi jo aapki zindagi mein jhanke..."

[0:03 - 0:06] Hard cut. A smooth, gliding tracking shot through the warm-toned living and dining area, matching #image4. The voiceover continues: "...sirf aapki privacy, aapka sukoon..."

[0:06 - 0:08] Hard cut. A rapid, sweeping low-angle pan across the stunning, high-ceiling luxury loft space, matching #image3. The voiceover continues: "...aur full-height windows jahan se sirf view dikhta hai, taak-jhaak nahi..."

[0:08 - 0:10] Hard cut. A quick snap-pan landing perfectly on the elegant dining setup with the mirror wall, matching #image2. The voiceover says: "...matlab, peace of mind, guaranteed."

[0:10 - 0:15] Hard cut. Back to Anvi (using #image7 for her facial features and #image5 for her black outfit). She is standing confidently inside the luxury living room, gently closing a set of curtains with a playful smirk. Looking directly into the lens, she says: "Toh agli baar koi padosi jhanke, toh bas curtains band kar dena. Neeche link par click karein aur apna private paradise book karein!" She completely stops speaking at exactly 13 seconds, leaving the final 2 seconds showing her playful smile as she finishes closing the curtain, ending the video naturally.`;

export const TEMPLATE_MARKERS = {
  A: ['#image1', '#image3', '#image5', '#image7', 'Anvi', 'Hard cut'],
  B: ['#image1', '#image2', '#image3', '#image4', '#image5', '#image7', 'Anvi', 'curtain', 'Hard cut'],
};

export function buildReproducePrompt({
  masterTemplate,
  dialogue,
  partLabel,
}: {
  masterTemplate: string;
  dialogue: string;
  partLabel: string;
}): string {
  return `Reproduce the following video-generation prompt EXACTLY, with ONE change: replace the SPOKEN dialogue (the quoted text following cues like "says," "whispers," "finishes," "continues," or "the voiceover says/starts/continues") with this actual dialogue, which must be spoken in full and unchanged: "${dialogue}"

You decide exactly where to split this dialogue across the spoken-dialogue quotes — it does not have to break at the same word as the example. You may also nudge the timestamp ranges in brackets (e.g. "[0:00 - 0:06]") so the pacing fits the new dialogue naturally — they must still start at 0:00, stay in the same order, and sum to 15 seconds total.

IMPORTANT: if the template contains a short parenthetical quote describing a GESTURE or expression rather than spoken words (for example a "shhh" gesture), leave that one exactly as written — do not replace it with dialogue.

Do NOT change anything else: keep every camera movement, action description, character description, image reference (#image1, #image2, etc.), and "Hard cut." exactly as written below. Do not invent dialogue beyond the actual dialogue given above.

TEMPLATE TO REPRODUCE (${partLabel}):
"""
${masterTemplate}
"""

Return ONLY the finished prompt text — no markdown fences, no preamble, no explanation.`;
}

export function fillTemplateAFallback(dialogue: string): string {
  const [beat1, beat2, beat3] = splitWordsIntoChunks(dialogue, 3);
  return MASTER_TEMPLATE_A.replace(`"Kya aap bhi apne padosiyon ki taak-jhaak se pareshan hain?"`, `"${beat1}"`)
    .replace(`"Tension mat lijiye! Main hoon Anvi..."`, `"${beat2}..."`)
    .replace(
      `"...aur aaj main aapko dikhaungi ek aisi private luxury property, jahan koi disturbance nahi!"`,
      `"...${beat3}"`,
    );
}

export function fillTemplateBFallback(dialogue: string): string {
  const sentences = dialogue.split(/(?<=[.?!])\s+/).filter(Boolean);
  const cta = sentences.length > 1 ? sentences.pop() : '';
  const highlights = sentences.join(' ') || dialogue;
  const stripEnd = (s: string) => s.replace(/[.?!]+$/, '');
  const [beat1, beat2, beat3, beat4] = splitWordsIntoChunks(highlights, 4).map(stripEnd);
  return MASTER_TEMPLATE_B.replace(`"Yahaan koi padosi nahi jo aapki zindagi mein jhanke..."`, `"${beat1}..."`)
    .replace(`"...sirf aapki privacy, aapka sukoon..."`, `"...${beat2}..."`)
    .replace(`"...aur full-height windows jahan se sirf view dikhta hai, taak-jhaak nahi..."`, `"...${beat3}..."`)
    .replace(`"...matlab, peace of mind, guaranteed."`, `"...${beat4}"`)
    .replace(
      `"Toh agli baar koi padosi jhanke, toh bas curtains band kar dena. Neeche link par click karein aur apna private paradise book karein!"`,
      `"${cta || beat4}"`,
    );
}
