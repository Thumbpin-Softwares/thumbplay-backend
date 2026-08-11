// Verbatim port of thumbpinclient/src/lib/sarvam-config.js. IDs are prefixed
// "sarvam:" so tts.service.ts can route a voiceId to the right provider.

export interface SarvamVoice {
  id: string;
  label: string;
}

export const SARVAM_VOICES: SarvamVoice[] = [
  // Male
  { id: 'sarvam:shubh', label: 'Shubh (Male)' },
  { id: 'sarvam:aditya', label: 'Aditya (Male)' },
  { id: 'sarvam:rahul', label: 'Rahul (Male)' },
  { id: 'sarvam:rohan', label: 'Rohan (Male)' },
  { id: 'sarvam:amit', label: 'Amit (Male)' },
  { id: 'sarvam:dev', label: 'Dev (Male)' },
  { id: 'sarvam:ratan', label: 'Ratan (Male)' },
  { id: 'sarvam:varun', label: 'Varun (Male)' },
  { id: 'sarvam:manan', label: 'Manan (Male)' },
  { id: 'sarvam:sumit', label: 'Sumit (Male)' },
  { id: 'sarvam:kabir', label: 'Kabir (Male)' },
  { id: 'sarvam:aayan', label: 'Aayan (Male)' },
  { id: 'sarvam:ashutosh', label: 'Ashutosh (Male)' },
  { id: 'sarvam:advait', label: 'Advait (Male)' },
  { id: 'sarvam:anand', label: 'Anand (Male)' },
  { id: 'sarvam:tarun', label: 'Tarun (Male)' },
  { id: 'sarvam:sunny', label: 'Sunny (Male)' },
  { id: 'sarvam:mani', label: 'Mani (Male)' },
  { id: 'sarvam:gokul', label: 'Gokul (Male)' },
  { id: 'sarvam:vijay', label: 'Vijay (Male)' },
  { id: 'sarvam:mohit', label: 'Mohit (Male)' },
  { id: 'sarvam:rehan', label: 'Rehan (Male)' },
  { id: 'sarvam:soham', label: 'Soham (Male)' },
  // Female
  { id: 'sarvam:ritu', label: 'Ritu (Female)' },
  { id: 'sarvam:priya', label: 'Priya (Female)' },
  { id: 'sarvam:neha', label: 'Neha (Female)' },
  { id: 'sarvam:pooja', label: 'Pooja (Female)' },
  { id: 'sarvam:simran', label: 'Simran (Female)' },
  { id: 'sarvam:kavya', label: 'Kavya (Female)' },
  { id: 'sarvam:ishita', label: 'Ishita (Female)' },
  { id: 'sarvam:shreya', label: 'Shreya (Female)' },
  { id: 'sarvam:roopa', label: 'Roopa (Female)' },
  { id: 'sarvam:tanya', label: 'Tanya (Female)' },
  { id: 'sarvam:shruti', label: 'Shruti (Female)' },
  { id: 'sarvam:suhani', label: 'Suhani (Female)' },
  { id: 'sarvam:kavitha', label: 'Kavitha (Female)' },
  { id: 'sarvam:rupali', label: 'Rupali (Female)' },
];

export const SARVAM_MODEL = 'bulbul:v3';

// Our internal `language` field -> Sarvam's target_language_code (BCP-47).
// hinglish/urdu have no dedicated Sarvam code - hi-IN handles code-mixed Hindi fine.
export const SARVAM_LANGUAGE_CODES: Record<string, string> = {
  english: 'en-IN',
  hindi: 'hi-IN',
  hinglish: 'hi-IN',
  urdu: 'hi-IN',
  marathi: 'mr-IN',
  tamil: 'ta-IN',
  telugu: 'te-IN',
  kannada: 'kn-IN',
  malayalam: 'ml-IN',
  bengali: 'bn-IN',
  gujarati: 'gu-IN',
  punjabi: 'pa-IN',
  odia: 'od-IN',
};
