import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { logger } from '../config/logger';

/**
 * Object-storage abstraction with three interchangeable backends, chosen at runtime:
 *
 *   - **r2**    — Cloudflare R2 (S3-compatible). Used when R2_* env vars are set.
 *                 The right choice for production (durable, unlimited, off the DB).
 *   - **mongo** — file bytes stored in a MongoDB `FileBlob` collection (the DEFAULT
 *                 when R2 is not configured). Survives Render redeploys and needs no
 *                 extra service — ideal for a free demo. Bound by Mongo's 16 MB
 *                 per-document limit (see MONGO_MAX_BYTES) and the cluster's storage.
 *   - **local** — local filesystem (opt-in via STORAGE_DRIVER=local) for offline dev.
 *
 * A "key" is a logical path like `materials/<uuid>.pdf` or `certificates/<no>.pdf`.
 */

/** Stay safely under MongoDB's hard 16 MB BSON document limit. */
const MONGO_MAX_BYTES = 15 * 1024 * 1024;

type Driver = 'r2' | 'mongo' | 'local';
function driver(): Driver {
  if (env.r2.enabled) return 'r2';
  if (process.env.STORAGE_DRIVER === 'local') return 'local';
  return 'mongo';
}

export function isR2(): boolean {
  return env.r2.enabled;
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: env.r2.endpoint,
      credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey },
    });
  }
  return _client;
}

function localPath(key: string): string {
  return path.join(env.storage.root, ...key.split('/'));
}

/** Persist a buffer under `key`. */
export async function putBuffer(key: string, body: Buffer, contentType?: string): Promise<void> {
  switch (driver()) {
    case 'r2':
      await client().send(new PutObjectCommand({ Bucket: env.r2.bucket, Key: key, Body: body, ContentType: contentType }));
      return;
    case 'mongo': {
      if (body.length > MONGO_MAX_BYTES) {
        throw new Error(
          `File is too large for MongoDB storage (${(body.length / 1024 / 1024).toFixed(1)} MB > 15 MB limit). Use a smaller file or configure Cloudflare R2.`,
        );
      }
      await prisma.fileBlob.upsert({
        where: { key },
        update: { data: body, contentType: contentType ?? null, size: body.length },
        create: { key, data: body, contentType: contentType ?? null, size: body.length },
      });
      return;
    }
    default: {
      const p = localPath(key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
  }
}

/** Move a file already on disk (a multer temp file) into storage under `key`. */
export async function putFile(key: string, sourcePath: string, contentType?: string): Promise<void> {
  if (driver() === 'local') {
    const p = localPath(key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    try {
      fs.renameSync(sourcePath, p);
    } catch (err) {
      // EXDEV: the multer temp dir and the storage dir are on DIFFERENT filesystems
      // (e.g. the container's own fs vs. a mounted Docker volume), so rename cannot
      // move across devices. Fall back to copy + delete, which works anywhere.
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        fs.copyFileSync(sourcePath, p);
        fs.unlinkSync(sourcePath);
      } else {
        throw err;
      }
    }
    return;
  }
  const buf = fs.readFileSync(sourcePath);
  try {
    await putBuffer(key, buf, contentType);
  } finally {
    fs.unlink(sourcePath, () => undefined); // best-effort temp cleanup
  }
}

/** Read an object fully into a Buffer. */
export async function getBuffer(key: string): Promise<Buffer> {
  switch (driver()) {
    case 'r2': {
      const res = await client().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
      const bytes = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
      return Buffer.from(bytes);
    }
    case 'mongo': {
      const blob = await prisma.fileBlob.findUnique({ where: { key } });
      if (!blob) throw new Error(`File not found in storage: ${key}`);
      return Buffer.from(blob.data);
    }
    default:
      return fs.readFileSync(localPath(key));
  }
}

/** Stream an object (for download endpoints). */
export async function getStream(key: string): Promise<Readable> {
  switch (driver()) {
    case 'r2': {
      const res = await client().send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
      return res.Body as Readable;
    }
    case 'mongo':
      return Readable.from(await getBuffer(key));
    default:
      return fs.createReadStream(localPath(key));
  }
}

/** Copy an object to a new key (used when attaching a library file to a topic). */
export async function copyObject(srcKey: string, destKey: string): Promise<void> {
  switch (driver()) {
    case 'r2':
      await client().send(new CopyObjectCommand({ Bucket: env.r2.bucket, CopySource: `${env.r2.bucket}/${srcKey}`, Key: destKey }));
      return;
    case 'mongo': {
      const src = await prisma.fileBlob.findUnique({ where: { key: srcKey } });
      if (!src) throw new Error(`Source file not found in storage: ${srcKey}`);
      await prisma.fileBlob.upsert({
        where: { key: destKey },
        update: { data: src.data, contentType: src.contentType, size: src.size },
        create: { key: destKey, data: src.data, contentType: src.contentType, size: src.size },
      });
      return;
    }
    default: {
      const s = localPath(srcKey);
      const d = localPath(destKey);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    switch (driver()) {
      case 'r2':
        await client().send(new HeadObjectCommand({ Bucket: env.r2.bucket, Key: key }));
        return true;
      case 'mongo':
        return (await prisma.fileBlob.count({ where: { key } })) > 0;
      default:
        return fs.existsSync(localPath(key));
    }
  } catch {
    return false;
  }
}

/** Physical delete. GMP records are soft-deleted in the DB; this is for true cleanup only. */
export async function removeObject(key: string): Promise<void> {
  try {
    switch (driver()) {
      case 'r2':
        await client().send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key }));
        return;
      case 'mongo':
        await prisma.fileBlob.deleteMany({ where: { key } });
        return;
      default: {
        const p = localPath(key);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
  } catch (e) {
    logger.warn(`storage.removeObject failed for "${key}": ${(e as Error).message}`);
  }
}

logger.info(
  `File storage backend: ${driver().toUpperCase()}${driver() === 'mongo' ? ' (files in MongoDB; ≤15 MB each — set R2_* for production)' : ''}.`,
);
