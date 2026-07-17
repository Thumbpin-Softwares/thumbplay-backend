import { ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3, BUCKET, R2_PUBLIC_URL } from '../reel/r2.service';
import { mapConcurrent } from '../../lib/concurrency';
import { cacheGet, cacheSet } from '../../lib/cache';

// Port of thumbpinclient's src/app/api/avatars/re/route.js, moved here for
// two reasons: (1) it needs no per-request auth hop back out to this same
// backend — requireAuth already resolved req.user before this runs — and
// (2) this data is shared across every user and rarely changes, so it's a
// textbook cache-aside candidate; re-scanning R2 from scratch on every
// single page load (as the old route did) is exactly what made it slow.

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const RE_PREFIX = 'Avatars/RE/';
const CONCURRENCY = 10;
const CACHE_KEY = 're-avatars:v1';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — shared/prebuilt library, changes rarely

export interface ReAvatarImage {
  url: string;
  key: string;
  index: number;
  displayName: string;
}

export interface ReAvatarCard {
  id: string;
  name: string;
  coverImage: string | undefined;
  imageCount: number;
  images: ReAvatarImage[];
  lastModified: Date | undefined;
}

function isImage(key: string): boolean {
  const dot = key.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(key.slice(dot).toLowerCase());
}

function publicUrl(key: string): string {
  return `${R2_PUBLIC_URL}/${key}`;
}

async function listReAvatarObjects() {
  const objects: { Key: string; LastModified?: Date }[] = [];
  let token: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: RE_PREFIX, ContinuationToken: token }),
    );
    for (const obj of resp.Contents ?? []) {
      if (obj.Key && isImage(obj.Key)) {
        objects.push({ Key: obj.Key, ...(obj.LastModified ? { LastModified: obj.LastModified } : {}) });
      }
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

interface HeadMeta {
  key: string;
  lastModified: Date | undefined;
  collectionId: string | null;
  collectionName: string | null;
  fileIndex: number;
}

// Runs the full R2 scan → group-into-collections → per-collection manifest
// fetch, invoking `onCard` the instant each collection's card is ready
// (during the manifest phase — the only phase where "which card" is known
// before the whole scan finishes). Returns the complete list for caching.
export async function scanReAvatars(onCard: (card: ReAvatarCard) => void): Promise<ReAvatarCard[]> {
  const objects = await listReAvatarObjects();
  if (objects.length === 0) return [];

  const heads = await mapConcurrent(objects, CONCURRENCY, async (obj): Promise<HeadMeta> => {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    return {
      key: obj.Key,
      lastModified: obj.LastModified,
      collectionId: h.Metadata?.['collection-id'] ?? null,
      collectionName: h.Metadata?.['collection-name'] ?? null,
      fileIndex: parseInt(h.Metadata?.['file-index'] ?? '0', 10),
    };
  });

  const collectionsMap = new Map<
    string,
    { id: string; name: string; images: ReAvatarImage[]; lastModified: Date | undefined }
  >();
  const ungrouped: ReAvatarCard[] = [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i]!;
    const meta = heads[i];
    const filename = obj.Key.slice(RE_PREFIX.length);
    const entry: ReAvatarImage = {
      url: publicUrl(obj.Key),
      key: obj.Key,
      index: meta?.fileIndex ?? 0,
      displayName: filename.replace(/\.[^/.]+$/, ''),
    };

    if (meta?.collectionId) {
      if (!collectionsMap.has(meta.collectionId)) {
        collectionsMap.set(meta.collectionId, {
          id: meta.collectionId,
          name: meta.collectionName || 'RE Agent',
          images: [],
          lastModified: obj.LastModified,
        });
      }
      collectionsMap.get(meta.collectionId)!.images.push(entry);
    } else {
      ungrouped.push({
        id: `legacy-${filename}`,
        name: entry.displayName || 'RE Agent',
        coverImage: entry.url,
        imageCount: 1,
        images: [entry],
        lastModified: obj.LastModified,
      });
    }
  }

  const collIds = Array.from(collectionsMap.keys());
  const cards: ReAvatarCard[] = [];
  let idx = 1;

  // Progressive: each collection's card is sent the moment ITS manifest
  // resolves, not after every collection's manifest has resolved.
  await mapConcurrent(
    collIds,
    CONCURRENCY,
    async (collId) => {
      const col = collectionsMap.get(collId)!;
      col.images.sort((a, b) => a.index - b.index);
      let thumbnailKey: string | undefined;
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `Avatars/meta/${collId}.json` }));
        const parsed = JSON.parse((await res.Body?.transformToString()) ?? '{}');
        thumbnailKey = parsed.thumbnailKey;
      } catch {
        // No manifest — fall back to the first image below.
      }
      const card: ReAvatarCard = {
        id: col.id,
        name: col.name || `RE Agent ${idx}`,
        coverImage: thumbnailKey ? publicUrl(thumbnailKey) : col.images[0]?.url,
        imageCount: col.images.length,
        images: col.images,
        lastModified: col.lastModified,
      };
      idx++;
      return card;
    },
    (card) => {
      cards.push(card);
      onCard(card);
    },
  );

  for (const leg of ungrouped) {
    leg.name = leg.name || `RE Agent ${idx}`;
    idx++;
    cards.push(leg);
    onCard(leg);
  }

  return cards;
}

export interface ReAvatarsResult {
  avatars: ReAvatarCard[];
  fromCache: boolean;
}

// Cache-aside: on a hit, the caller can stream the cached array back
// instantly (still one SSE event per card, so the client-side trickling
// effect is preserved even though the server already has everything).
export async function getReAvatars(onCard: (card: ReAvatarCard) => void): Promise<ReAvatarsResult> {
  const cached = cacheGet<ReAvatarCard[]>(CACHE_KEY);
  if (cached) {
    for (const card of cached) onCard(card);
    return { avatars: cached, fromCache: true };
  }

  const avatars = await scanReAvatars(onCard);
  cacheSet(CACHE_KEY, avatars, CACHE_TTL_MS);
  return { avatars, fromCache: false };
}
