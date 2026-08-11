import { splitWordsIntoChunks } from '../reel/template-reproduce.service';

// Verbatim port of the "car exit" master templates from
// thumbpinclient/src/app/api/luxury-car-exit/generate-pipeline/route.js
// (the current live source of what this app used to call "seedance-reel").

export const MASTER_TEMPLATE_A = `A hyper-realistic, vertical (9:16) UGC-style luxury real estate vlog. Natural, dynamic lighting. It looks like a high-budget smartphone video. All spoken dialogue is delivered in a natural, conversational Hindi accent - casual everyday rhythm and pacing, like a real person talking to a friend, not overly enunciated or textbook-perfect.

[0:00 - 0:05] The video opens with a sleek luxury car pulling up to a stop. The female agent, Anvi (using #image7 for her facial features and #image5 for her black outfit), steps out of the car with effortless elegance and begins walking confidently toward the camera. She holds the camera selfie-style and looks directly into the lens with warm, inviting energy and says: "Kya aapne kabhi socha hai ki aapka agla ghar bilkul filmy ho sakta hai? Hello, main hoon Anvi..."

[0:05 - 0:08] Hard cut. The camera suddenly snaps to a sweeping establishing shot of a massive modern luxury villa exterior, matching exactly with #image1.

[0:08 - 0:11] Hard cut. A smooth, elegant panning shot of a striking interior space with premium finishes, exactly matching #image2.

[0:11 - 0:15] Hard cut. Back to the agent Anvi (#image7 and #image5), now standing at the villa's entrance with the luxury car still visible behind her. She smiles confidently, holding the camera selfie-style, and finishes her sentence: "...aapki real estate expert, aur aaj main aapko dikhane waali hoon aapka naya dream home!" She stops speaking at exactly 13 seconds and spends the final 2 seconds simply holding a bright, confident smile at the camera, ending the video naturally.`;

export const MASTER_TEMPLATE_B = `A hyper-realistic, vertical (9:16) UGC-style high-energy luxury real estate vlog. Dynamic, fast-paced cinematic editing. Natural interior lighting. All spoken dialogue is delivered in a natural, conversational Hindi accent - casual everyday rhythm and pacing, like a real person talking to a friend, not overly enunciated or textbook-perfect.

[0:00 - 0:03] The video opens with a fast, sweeping shot moving towards the modern luxury villa exterior, matching exactly with #image1. The voiceover starts: "Zara sochiye... itna khoobsurat ghar..."

[0:03 - 0:06] Hard cut. A rapid, sweeping low-angle pan across a stunning, high-ceiling luxury living space, matching #image3. The voiceover continues: "...premium living space..."

[0:06 - 0:08] Hard cut. A smooth, gliding tracking shot moving through a warm-toned interior area, matching #image4. The voiceover continues: "...shandaar designer decor..."

[0:08 - 0:10] Hard cut. A quick snap-pan landing perfectly on an elegant space showcasing premium finishes, matching #image2. The voiceover says: "...aur ek perfect vibe. Hai na kamaal?"

[0:10 - 0:15] Hard cut. Back to the female agent, Anvi (using #image7 for her facial features and #image5 for her black outfit). She is standing confidently beside the luxury car outside the property. Looking directly into the lens, she enthusiastically points her finger down toward the CTA link, and then playfully tosses a set of car keys directly toward the camera lens. She says: "Toh intezaar kaisa? Neeche diye gaye link par abhi click karein aur apna dream home book karein!" She completely stops speaking at exactly 13 seconds, leaving the final 2 seconds showing her confident smile as the keys fly toward the viewer, ending the video naturally.`;

export const TEMPLATE_MARKERS = {
  A: ['#image1', '#image2', '#image5', '#image7', 'luxury car', 'Hard cut'],
  B: ['#image1', '#image2', '#image3', '#image4', '#image5', '#image7', 'keys', 'Hard cut'],
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
  return `Reproduce the following video-generation prompt EXACTLY, with ONE change: replace all of the example spoken dialogue (the text inside quotation marks) with this actual dialogue, which must be spoken in full and unchanged: "${dialogue}"

You decide exactly where to split this dialogue across the quoted lines - it does not have to break at the same word as the example. You may also nudge the timestamp ranges in brackets (e.g. "[0:00 - 0:05]") so the pacing fits the new dialogue naturally - they must still start at 0:00, stay in the same order, and sum to 15 seconds total.

Do NOT change anything else: keep every camera movement, action description, character description, image reference (#image1, #image2, etc.), and "Hard cut." exactly as written below. Do not invent dialogue beyond the actual dialogue given above.

TEMPLATE TO REPRODUCE (${partLabel}):
"""
${masterTemplate}
"""

Return ONLY the finished prompt text - no markdown fences, no preamble, no explanation.`;
}

export function fillTemplateAFallback(dialogue: string): string {
  const [beat1, beat2] = splitWordsIntoChunks(dialogue, 2);
  return MASTER_TEMPLATE_A.replace(
    `"Kya aapne kabhi socha hai ki aapka agla ghar bilkul filmy ho sakta hai? Hello, main hoon Anvi..."`,
    `"${beat1}..."`,
  ).replace(
    `"...aapki real estate expert, aur aaj main aapko dikhane waali hoon aapka naya dream home!"`,
    `"...${beat2}"`,
  );
}

export function fillTemplateBFallback(dialogue: string): string {
  const sentences = dialogue.split(/(?<=[.?!])\s+/).filter(Boolean);
  const cta = sentences.length > 1 ? sentences.pop() : '';
  const highlights = sentences.join(' ') || dialogue;
  const stripEnd = (s: string) => s.replace(/[.?!]+$/, '');
  const [beat1, beat2, beat3, beat4] = splitWordsIntoChunks(highlights, 4).map(stripEnd);
  return MASTER_TEMPLATE_B.replace(`"Zara sochiye... itna khoobsurat ghar..."`, `"${beat1}..."`)
    .replace(`"...premium living space..."`, `"...${beat2}..."`)
    .replace(`"...shandaar designer decor..."`, `"...${beat3}..."`)
    .replace(`"...aur ek perfect vibe. Hai na kamaal?"`, `"...${beat4}"`)
    .replace(
      `"Toh intezaar kaisa? Neeche diye gaye link par abhi click karein aur apna dream home book karein!"`,
      `"${cta || beat4}"`,
    );
}
