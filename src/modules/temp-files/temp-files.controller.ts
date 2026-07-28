import { Request, Response } from 'express';
import { AuthedRequest } from '../auth/auth.types';
import { CreateTempFileInput, createTempFile, createTempFileFromUrl, getTempFile } from './temp-files.service';

function numberFrom(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

type LooseCreateOptions = {
  [Key in keyof Omit<CreateTempFileInput, 'buffer'>]?: Omit<CreateTempFileInput, 'buffer'>[Key] | undefined;
};

function createOptions(input: LooseCreateOptions): Omit<CreateTempFileInput, 'buffer'> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Omit<
    CreateTempFileInput,
    'buffer'
  >;
}

export async function create(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const uploadedFile = req.file;
    const body = req.body ?? {};
    const query = req.query ?? {};

    const expiresInSeconds =
      numberFrom(body.expiresInSeconds) ?? numberFrom(body.ttlSeconds) ?? numberFrom(query.expiresInSeconds);
    const expiresAt = stringFrom(body.expiresAt) ?? stringFrom(query.expiresAt);
    const filename = stringFrom(body.filename) ?? stringFrom(query.filename);
    const contentType = stringFrom(body.contentType) ?? stringFrom(query.contentType);

    if (uploadedFile) {
      const result = await createTempFile({
        buffer: uploadedFile.buffer,
        ...createOptions({
          filename: filename || uploadedFile.originalname,
          contentType: contentType || uploadedFile.mimetype,
          expiresInSeconds,
          expiresAt,
        }),
      });
      res.status(201).json(result);
      return;
    }

    if (Buffer.isBuffer(body)) {
      const result = await createTempFile({
        buffer: body,
        ...createOptions({
          filename,
          contentType: contentType || req.headers['content-type'],
          expiresInSeconds,
          expiresAt,
        }),
      });
      res.status(201).json(result);
      return;
    }

    const fileUrl = stringFrom(body.fileUrl);
    if (fileUrl) {
      const result = await createTempFileFromUrl(fileUrl, createOptions({
        filename,
        contentType,
        expiresInSeconds,
        expiresAt,
      }));
      res.status(201).json(result);
      return;
    }

    res.status(400).json({ error: 'Send multipart file field `file`, raw binary body, or JSON `fileUrl`' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create temporary file';
    console.error('[TempFiles] create error:', error);
    res.status(400).json({ error: message });
  }
}

export async function serve(req: Request, res: Response): Promise<void> {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      res.status(400).json({ error: 'Missing file id' });
      return;
    }

    const tempFile = await getTempFile(id);
    if (!tempFile) {
      res.status(410).json({ error: 'Temporary file expired' });
      return;
    }

    res.setHeader('Content-Type', tempFile.meta.contentType);
    res.setHeader('Content-Length', tempFile.meta.size.toString());
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${tempFile.meta.filename.replace(/"/g, '')}"`);
    tempFile.stream.pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'Temporary file not found' });
  }
}
