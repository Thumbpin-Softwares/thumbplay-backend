import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import crypto from 'node:crypto';
import { env } from '../../config/env';

const STORAGE_DIR = join(process.cwd(), 'local-temp-files');
const DEFAULT_TTL_SECONDS = 60 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

interface TempFileMeta {
  id: string;
  filename: string;
  contentType: string;
  expiresAt: string;
  size: number;
}

export interface CreateTempFileInput {
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  expiresInSeconds?: number;
  expiresAt?: string;
}

function safeFilename(value: string | undefined, fallback: string): string {
  const filename = (value || fallback).split(/[\\/]/).pop() || fallback;
  return filename.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 120) || fallback;
}

function extensionForContentType(contentType: string): string {
  const type = contentType.split(';')[0]?.trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'application/pdf': '.pdf',
    'application/json': '.json',
    'text/plain': '.txt',
  };
  return type ? map[type] || '' : '';
}

function resolveExpiry(input: Pick<CreateTempFileInput, 'expiresAt' | 'expiresInSeconds'>): Date {
  if (input.expiresAt) {
    const date = new Date(input.expiresAt);
    if (Number.isNaN(date.getTime())) throw new Error('expiresAt must be a valid date');
    if (date.getTime() <= Date.now()) throw new Error('expiresAt must be in the future');
    if (date.getTime() > Date.now() + MAX_TTL_SECONDS * 1000) {
      throw new Error(`Expiry cannot be more than ${MAX_TTL_SECONDS} seconds from now`);
    }
    return date;
  }

  const ttl = input.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('expiresInSeconds must be a positive number');
  if (ttl > MAX_TTL_SECONDS) throw new Error(`expiresInSeconds cannot exceed ${MAX_TTL_SECONDS}`);
  return new Date(Date.now() + ttl * 1000);
}

async function ensureStorageDir(): Promise<void> {
  await mkdir(STORAGE_DIR, { recursive: true });
}

function pathsFor(id: string) {
  return {
    filePath: join(STORAGE_DIR, id),
    metaPath: join(STORAGE_DIR, `${id}.json`),
  };
}

export async function createTempFile(input: CreateTempFileInput) {
  if (!input.buffer.byteLength) throw new Error('File is empty');
  if (input.buffer.byteLength > MAX_FILE_BYTES) throw new Error('File exceeds the 100 MB limit');

  await ensureStorageDir();

  const id = crypto.randomUUID();
  const contentType = input.contentType || 'application/octet-stream';
  const fallbackName = `temp-file${extensionForContentType(contentType)}`;
  const filename = safeFilename(input.filename, fallbackName);
  const expiresAt = resolveExpiry(input);
  const { filePath, metaPath } = pathsFor(id);

  const meta: TempFileMeta = {
    id,
    filename,
    contentType,
    expiresAt: expiresAt.toISOString(),
    size: input.buffer.byteLength,
  };

  await writeFile(filePath, input.buffer);
  await writeFile(metaPath, JSON.stringify(meta, null, 2));

  const publicUrl = `${env.backendPublicUrl.replace(/\/+$/, '')}/api/v1/temp-files/${id}/${encodeURIComponent(filename)}`;
  return { id, url: publicUrl, expiresAt: meta.expiresAt, size: meta.size, contentType: meta.contentType };
}

export async function createTempFileFromUrl(
  fileUrl: string,
  options: Omit<CreateTempFileInput, 'buffer'> = {},
) {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new Error('fileUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('fileUrl must use http or https');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download fileUrl: HTTP ${res.status}`);

  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_BYTES) throw new Error('Remote file exceeds the 100 MB limit');

  const buffer = Buffer.from(await res.arrayBuffer());
  const filename = options.filename || decodeURIComponent(url.pathname.split('/').pop() || '');
  const createInput: CreateTempFileInput = {
    ...options,
    buffer,
    filename,
  };
  const responseContentType = res.headers.get('content-type') || undefined;
  if (!createInput.contentType && responseContentType) createInput.contentType = responseContentType;
  return createTempFile(createInput);
}

export async function getTempFile(id: string) {
  const { filePath, metaPath } = pathsFor(id);
  const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as TempFileMeta;

  if (new Date(meta.expiresAt).getTime() <= Date.now()) {
    await removeTempFile(id);
    return null;
  }

  const fileStat = await stat(filePath);
  return {
    meta: { ...meta, size: fileStat.size },
    stream: createReadStream(filePath),
  };
}

export async function removeTempFile(id: string): Promise<void> {
  const { filePath, metaPath } = pathsFor(id);
  await Promise.all([rm(filePath, { force: true }), rm(metaPath, { force: true })]);
}

export async function cleanupExpiredTempFiles(): Promise<void> {
  await ensureStorageDir();
  const entries = await readdir(STORAGE_DIR);
  await Promise.all(
    entries
      .filter((name) => extname(name) === '.json')
      .map(async (name) => {
        try {
          const meta = JSON.parse(await readFile(join(STORAGE_DIR, name), 'utf-8')) as TempFileMeta;
          if (new Date(meta.expiresAt).getTime() <= Date.now()) await removeTempFile(meta.id);
        } catch {
          await rm(join(STORAGE_DIR, name), { force: true });
        }
      }),
  );
}

cleanupExpiredTempFiles().catch((error) => console.error('[TempFiles] cleanup failed:', error));
const cleanupInterval = setInterval(() => {
  cleanupExpiredTempFiles().catch((error) => console.error('[TempFiles] cleanup failed:', error));
}, 5 * 60 * 1000);
cleanupInterval.unref();
