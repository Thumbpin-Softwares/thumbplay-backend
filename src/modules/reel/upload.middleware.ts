import multer from 'multer';

// Shared multipart/form-data field shape for all three pipelines'
// generate-pipeline endpoint: up to 4 location images, up to 3 avatar URLs
// (plain text fields, handled separately), and one optional custom-voice
// recording. Memory storage - files are small (single images/audio clips)
// and get streamed straight to R2, no need to touch disk.
const upload = multer({ storage: multer.memoryStorage() });

export const reelUploadFields = upload.fields([
  { name: 'locationImage_0', maxCount: 1 },
  { name: 'locationImage_1', maxCount: 1 },
  { name: 'locationImage_2', maxCount: 1 },
  { name: 'locationImage_3', maxCount: 1 },
  { name: 'customVoiceFile', maxCount: 1 },
]);

export type ReelUploadFiles = Record<string, Express.Multer.File[]>;
