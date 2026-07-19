import { randomUUID } from 'crypto';
import {
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { s3, BUCKET, R2_PUBLIC_URL } from '../reel/r2.service';
import { mapConcurrent } from '../../lib/concurrency';
import { cacheGet, cacheSet, cacheDelete } from '../../lib/cache';

// Port of thumbpinclient's admin avatars routes, which scanned R2 with a
// fully sequential `for (const obj of objects) { await headObject(obj) }`
// loop — one round-trip at a time, blocking the whole response until every
// object in the bucket had been HEAD'd. Same fix shape as the re-avatars
// module: concurrent HEAD requests + a short cache-aside layer, since this
// is admin tooling (mutated occasionally, read far more often).

const PREFIX = 'Avatars/';
const META_PREFIX = 'Avatars/meta/';
const CONCURRENCY = 10;
const CACHE_KEY = 'admin-avatars:v1';
const CACHE_TTL_MS = 60 * 1000; // short — this data changes whenever an admin uploads/deletes

export type AdminAvatarType = 'real-estate';

export interface AdminAvatarFile {
  key: string;
  filename: string;
  url: string;
  index: number;
}

export interface AdminAvatarCollection {
  id: string;
  name: string;
  type: AdminAvatarType;
  createdAt: string;
  fileCount: number;
  coverImage: string;
  thumbnailKey: string | undefined;
  files: AdminAvatarFile[];
}

function publicUrl(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

function filenameOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

async function listRawObjects(): Promise<{ Key: string }[]> {
  const objects: { Key: string }[] = [];
  let token: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key && !obj.Key.endsWith('/') && !obj.Key.startsWith(META_PREFIX)) {
        objects.push({ Key: obj.Key });
      }
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

interface HeadMeta {
  key: string;
  collectionId: string | null;
  collectionName: string;
  type: AdminAvatarType;
  fileIndex: number;
  uploadedAt: string;
}

async function scanCollections(): Promise<AdminAvatarCollection[]> {
  const objects = await listRawObjects();
  if (objects.length === 0) return [];

  const heads = await mapConcurrent(objects, CONCURRENCY, async (obj): Promise<HeadMeta> => {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    return {
      key: obj.Key,
      collectionId: h.Metadata?.['collection-id'] ?? null,
      collectionName: h.Metadata?.['collection-name'] || 'Untitled',
      type: (h.Metadata?.['type'] as AdminAvatarType) || 'real-estate',
      fileIndex: parseInt(h.Metadata?.['file-index'] ?? '0', 10),
      uploadedAt: h.Metadata?.['uploaded-at'] || new Date().toISOString(),
    };
  });

  const collectionsMap = new Map<
    string,
    { name: string; type: AdminAvatarType; createdAt: string; files: AdminAvatarFile[] }
  >();

  for (const meta of heads) {
    if (!meta?.collectionId) continue;
    if (!collectionsMap.has(meta.collectionId)) {
      collectionsMap.set(meta.collectionId, {
        name: meta.collectionName,
        type: meta.type,
        createdAt: meta.uploadedAt,
        files: [],
      });
    }
    collectionsMap.get(meta.collectionId)!.files.push({
      key: meta.key,
      filename: filenameOf(meta.key),
      url: publicUrl(meta.key),
      index: meta.fileIndex,
    });
  }

  const collections: AdminAvatarCollection[] = [];
  await mapConcurrent(
    Array.from(collectionsMap.entries()),
    CONCURRENCY,
    async ([collId, coll]) => {
      coll.files.sort((a, b) => a.index - b.index);
      let thumbnailKey: string | undefined;
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${META_PREFIX}${collId}.json` }));
        const parsed = JSON.parse((await res.Body?.transformToString()) ?? '{}');
        thumbnailKey = parsed.thumbnailKey;
      } catch {
        // No manifest — fall back to the first file below.
      }
      return {
        id: collId,
        name: coll.name,
        type: coll.type,
        createdAt: coll.createdAt,
        fileCount: coll.files.length,
        coverImage: thumbnailKey ? publicUrl(thumbnailKey) : coll.files[0]!.url,
        thumbnailKey,
        files: coll.files,
      };
    },
    (card) => collections.push(card),
  );

  collections.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return collections;
}

async function getCollectionsCached(): Promise<AdminAvatarCollection[]> {
  const cached = cacheGet<AdminAvatarCollection[]>(CACHE_KEY);
  if (cached) return cached;
  const collections = await scanCollections();
  cacheSet(CACHE_KEY, collections, CACHE_TTL_MS);
  return collections;
}

function invalidateCache(): void {
  cacheDelete(CACHE_KEY);
}

export async function listCollections(): Promise<{ collections: AdminAvatarCollection[]; total: number }> {
  const all = await getCollectionsCached();
  return { collections: all, total: all.length };
}

export async function getCollection(collectionId: string): Promise<AdminAvatarCollection | null> {
  const all = await getCollectionsCached();
  return all.find((c) => c.id === collectionId) ?? null;
}

export interface CreateCollectionFile {
  buffer: Buffer;
  contentType: string;
  originalName: string;
}

export async function createCollection(params: {
  type: AdminAvatarType;
  name: string;
  files: CreateCollectionFile[];
}): Promise<AdminAvatarCollection> {
  const { type, name, files } = params;
  const collectionId = randomUUID();
  const uploadedFiles: AdminAvatarFile[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const ext = file.originalName.includes('.') ? file.originalName.slice(file.originalName.lastIndexOf('.')) : '.png';
    const filename = `${collectionId}_${i + 1}${ext}`;
    const key = `Avatars/RE/${filename}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.contentType,
        Metadata: {
          'collection-id': collectionId,
          'collection-name': name,
          type,
          'file-index': i.toString(),
          'total-files': files.length.toString(),
          'uploaded-at': new Date().toISOString(),
        },
      }),
    );

    uploadedFiles.push({ key, filename, url: publicUrl(key), index: i });
  }

  invalidateCache();

  return {
    id: collectionId,
    name,
    type,
    createdAt: new Date().toISOString(),
    fileCount: uploadedFiles.length,
    coverImage: uploadedFiles[0]!.url,
    thumbnailKey: undefined,
    files: uploadedFiles,
  };
}

export async function deleteCollection(collectionId: string): Promise<{ deletedCount: number }> {
  const collection = await getCollection(collectionId);
  if (!collection) return { deletedCount: 0 };

  await mapConcurrent(collection.files, CONCURRENCY, (file) =>
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: file.key })),
  );

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `${META_PREFIX}${collectionId}.json` }));
  } catch {
    // No manifest to delete.
  }

  invalidateCache();
  return { deletedCount: collection.files.length };
}

export async function setThumbnail(collectionId: string, thumbnailKey: string): Promise<{ coverImage: string }> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${META_PREFIX}${collectionId}.json`,
      Body: JSON.stringify({ thumbnailKey }),
      ContentType: 'application/json',
    }),
  );
  invalidateCache();
  return { coverImage: publicUrl(thumbnailKey) };
}
