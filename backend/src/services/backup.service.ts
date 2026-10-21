import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { ensureDir } from '../utils/fileUtils';
import { recordEvent } from './auditTrail.service';
import { storageDriver } from './storage.service';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import type { ElectronicSignature } from '@prisma/client';

const run = promisify(execFile);
const PREFIX = 'backups/';
const NAME = /^izlearn-full-\d{8}T\d{6}-[a-f0-9]{8}\.tar\.gz$/;
const PARTS = ['manifest.json', 'database.archive.gz', 'files.tar.gz'];
let busy = false;

interface Manifest {
  format: 1;
  createdAt: string;
  appVersion: string;
  storageDriver: 'local' | 'r2' | 'mongo';
  filesCount: number;
  databaseSha256: string;
  filesSha256: string;
  scope: 'database-and-uploads';
}

function client(): S3Client {
  return new S3Client({ region: 'auto', endpoint: env.r2.endpoint,
    credentials: { accessKeyId: env.r2.accessKeyId, secretAccessKey: env.r2.secretAccessKey } });
}
function remote(): boolean {
  const configured = process.env.BACKUP_STORAGE_DRIVER;
  if (configured && configured !== 'r2' && configured !== 'local') throw new Error('Invalid BACKUP_STORAGE_DRIVER.');
  return (configured || (env.r2.enabled ? 'r2' : 'local')) === 'r2';
}
function bucket(): string {
  const name = process.env.BACKUP_R2_BUCKET || env.r2.bucket;
  if (!name || !env.r2.enabled) throw new Error('R2 backup storage requires R2 credentials and a bucket.');
  return name;
}
function localDirectory(): string {
  const dir = path.resolve(process.env.BACKUP_DESTINATION || env.storage.backups);
  const root = path.resolve(env.storage.root);
  if (dir === root || root.startsWith(`${dir}${path.sep}`)) throw new Error('Backup destination must not contain the live file storage root.');
  ensureDir(dir);
  return dir;
}
function safeKey(key: string): boolean {
  return !!key && !key.startsWith('/') && !key.startsWith('\\') && !key.includes('\\') && !key.includes(':') &&
    !key.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}
async function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}
async function objects(s3: S3Client, name: string, prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: name, Prefix: prefix, ContinuationToken: token }));
    for (const item of page.Contents ?? []) if (item.Key) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
async function copyUploads(dest: string): Promise<number> {
  ensureDir(dest);
  const driver = storageDriver();
  if (driver === 'mongo') return 0; // FileBlob records are included in mongodump.
  if (driver === 'local') {
    const root = path.resolve(env.storage.root);
    if (!fs.existsSync(root)) return 0;
    const backupDir = localDirectory();
    const tempDir = path.resolve(env.storage.tmp);
    let count = 0;
    fs.cpSync(root, dest, { recursive: true, filter: (source) => {
      const resolved = path.resolve(source);
      if (resolved === backupDir || resolved.startsWith(`${backupDir}${path.sep}`)) return false;
      if (resolved === tempDir || resolved.startsWith(`${tempDir}${path.sep}`)) return false;
      if (fs.lstatSync(source).isSymbolicLink()) return false;
      if (fs.statSync(source).isFile()) count++;
      return true;
    } });
    return count;
  }
  const s3 = client();
  let count = 0;
  for (const key of await objects(s3, env.r2.bucket)) {
    if (key.startsWith(PREFIX)) continue;
    if (!safeKey(key)) throw new Error(`Unsafe file key: ${key}`);
    const file = path.join(dest, ...key.split('/'));
    ensureDir(path.dirname(file));
    const result = await s3.send(new GetObjectCommand({ Bucket: env.r2.bucket, Key: key }));
    await pipeline(result.Body as Readable, fs.createWriteStream(file));
    count++;
  }
  return count;
}
async function withWork<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-backup-'));
  try { return await fn(dir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
async function putArchive(file: string, name: string): Promise<void> {
  if (!remote()) {
    const dest = path.join(localDirectory(), name);
    const partial = `${dest}.partial`;
    try { fs.copyFileSync(file, partial); fs.renameSync(partial, dest); }
    finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
    return;
  }
  const size = fs.statSync(file).size;
  if (size > 5 * 1024 ** 3) throw new Error('Backup exceeds the R2 single-object upload limit (5 GB).');
  await client().send(new PutObjectCommand({ Bucket: bucket(), Key: `${PREFIX}${name}`,
    Body: fs.createReadStream(file), ContentLength: size, ContentType: 'application/gzip' }));
}
async function getArchive(name: string, dest: string): Promise<void> {
  if (!NAME.test(name)) throw new Error('Invalid backup name.');
  if (!remote()) { fs.copyFileSync(path.join(localDirectory(), name), dest); return; }
  const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: `${PREFIX}${name}` }));
  await pipeline(result.Body as Readable, fs.createWriteStream(dest));
}
export async function openBackupArchive(name: string): Promise<{ stream: Readable; size: number }> {
  if (!NAME.test(name)) throw new Error('Invalid backup name.');
  if (!remote()) {
    const file = path.join(localDirectory(), name);
    return { stream: fs.createReadStream(file), size: fs.statSync(file).size };
  }
  const result = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: `${PREFIX}${name}` }));
  return { stream: result.Body as Readable, size: result.ContentLength ?? 0 };
}
async function unpack(file: string, dir: string): Promise<Manifest> {
  const stdout = await new Promise<string>((resolve, reject) =>
    execFile('tar', ['-tzf', file], { maxBuffer: 64 * 1024 * 1024 }, (error, output) => error ? reject(error) : resolve(output)));
  const entries = stdout.trim().split(/\r?\n/);
  if (entries.length !== PARTS.length || entries.some((entry) => !PARTS.includes(entry))) {
    throw new Error('Backup has unexpected archive paths.');
  }
  await run('tar', ['-xzf', file, '-C', dir]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.format !== 1 || manifest.scope !== 'database-and-uploads') throw new Error('Unsupported backup format.');
  if (await sha256(path.join(dir, 'database.archive.gz')) !== manifest.databaseSha256 ||
      await sha256(path.join(dir, 'files.tar.gz')) !== manifest.filesSha256) throw new Error('Backup checksum mismatch.');
  return manifest;
}

async function createBackup(triggeredBy: string) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
    const name = `izlearn-full-${stamp}-${crypto.randomBytes(4).toString('hex')}.tar.gz`;
    const result = await withWork(async (dir) => {
      const database = path.join(dir, PARTS[1]);
      const uploads = path.join(dir, 'uploads');
      const files = path.join(dir, PARTS[2]);
      const archive = path.join(dir, name);
      await run(env.mongo.dumpBin, [`--uri=${env.databaseUrl}`, `--archive=${database}`, '--gzip']);
      const filesCount = await copyUploads(uploads);
      await run('tar', ['-czf', files, '-C', uploads, '.']);
      const manifest: Manifest = { format: 1, createdAt: new Date().toISOString(),
        appVersion: process.env.APP_VERSION || process.env.RENDER_GIT_COMMIT || 'unknown',
        storageDriver: storageDriver(), filesCount, databaseSha256: await sha256(database),
        filesSha256: await sha256(files), scope: 'database-and-uploads' };
      fs.writeFileSync(path.join(dir, PARTS[0]), JSON.stringify(manifest, null, 2));
      await run('tar', ['-czf', archive, '-C', dir, ...PARTS]);
      await putArchive(archive, name);
      return { file: name, sizeBytes: fs.statSync(archive).size, manifest };
    });
    await recordEvent({ action: 'BACKUP_TRIGGERED', entityType: 'Backup', entityId: name,
      newValue: { triggeredBy, sizeBytes: result.sizeBytes, filesCount: result.manifest.filesCount } });
    logger.info(`Full backup written: ${name}`);
    return result;
}

export async function runBackup(triggeredBy: string) {
  if (busy) throw new Error('A backup or restore is already running.');
  busy = true;
  try { return await createBackup(triggeredBy); }
  finally { busy = false; }
}

export async function listBackups() {
  if (!remote()) return fs.readdirSync(localDirectory()).filter((file) => NAME.test(file)).map((file) => {
    const stat = fs.statSync(path.join(localDirectory(), file));
    return { file, sizeBytes: stat.size, createdAt: stat.mtime.toISOString(), destination: 'local' };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const s3 = client();
  const output: Array<{ file: string; sizeBytes: number; createdAt: string; destination: string }> = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: PREFIX, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      const file = item.Key?.slice(PREFIX.length) ?? '';
      if (NAME.test(file)) output.push({ file, sizeBytes: item.Size ?? 0,
        createdAt: item.LastModified?.toISOString() ?? '', destination: 'r2' });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return output.sort((a, b) => b.file.localeCompare(a.file));
}

export async function verifyBackup(fileName: string) {
  return withWork(async (dir) => {
    const archive = path.join(dir, 'bundle.tar.gz');
    await getArchive(fileName, archive);
    const manifest = await unpack(archive, dir);
    await recordEvent({ action: 'BACKUP_VERIFIED', entityType: 'Backup', entityId: fileName,
      newValue: { valid: true, filesCount: manifest.filesCount } });
    return { file: fileName, valid: true, manifest };
  });
}

/** Destructive restore: permitted only during an operator-controlled maintenance window. */
export async function restoreBackup(fileName: string, triggeredBy: string, signature: ElectronicSignature) {
  if (process.env.BACKUP_RESTORE_ENABLED !== 'true') throw new Error('Enable BACKUP_RESTORE_ENABLED only during a maintenance window.');
  if (busy) throw new Error('A backup or restore is already running.');
  busy = true;
  try {
    return await withWork(async (dir) => {
      const archive = path.join(dir, 'bundle.tar.gz');
      await getArchive(fileName, archive);
      const manifest = await unpack(archive, dir);
      const files = path.join(dir, 'restored-files');
      ensureDir(files);
      const fileArchive = path.join(dir, PARTS[2]);
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile('tar', ['-tzf', fileArchive], { maxBuffer: 64 * 1024 * 1024 }, (error, output) => error ? reject(error) : resolve(output)));
      for (const entry of stdout.split(/\r?\n/).filter(Boolean)) {
        const relative = entry.replace(/^\.\//, '').replace(/\/$/, '');
        if (relative && !safeKey(relative)) throw new Error('File archive contains an unsafe path.');
      }
      await run('tar', ['-xzf', fileArchive, '-C', files]);
      if ((manifest.storageDriver === 'mongo') !== (storageDriver() === 'mongo')) {
        throw new Error('File storage mode differs from the backup. Configure the matching storage mode before restore.');
      }
      const safety = await createBackup(`PRE_RESTORE:${triggeredBy}`);
      logger.warn(`Pre-restore safety backup created: ${safety.file}`);
      await run(env.mongo.restoreBin, [`--uri=${env.databaseUrl}`, `--archive=${path.join(dir, PARTS[1])}`, '--gzip', '--drop']);
      if (storageDriver() === 'local') {
        const root = path.resolve(env.storage.root);
        if (root === path.parse(root).root || root === path.resolve('.')) throw new Error('Unsafe storage root.');
        ensureDir(root);
        const backupDir = localDirectory();
        const tempDir = path.resolve(env.storage.tmp);
        const restored = new Set<string>();
        const collect = (folder: string, relative = ''): void => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const rel = path.join(relative, entry.name);
            if (entry.isDirectory()) collect(path.join(folder, entry.name), rel);
            else if (entry.isFile()) restored.add(rel);
          }
        };
        collect(files);
        // Copy first so a failed copy leaves existing files available for recovery.
        fs.cpSync(files, root, { recursive: true });
        const prune = (folder: string, relative = ''): void => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const target = path.join(folder, entry.name);
            if (target === backupDir || backupDir.startsWith(`${target}${path.sep}`) ||
                target === tempDir || tempDir.startsWith(`${target}${path.sep}`)) continue;
            const rel = path.join(relative, entry.name);
            if (entry.isDirectory()) prune(target, rel);
            else if (entry.isFile() && !restored.has(rel)) fs.unlinkSync(target);
            else if (entry.isSymbolicLink()) fs.unlinkSync(target);
          }
        };
        prune(root);
      } else if (storageDriver() === 'r2') {
        const s3 = client();
        const restoredKeys = new Set<string>();
        const upload = async (folder: string, prefix = ''): Promise<void> => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const key = prefix ? `${prefix}/${entry.name}` : entry.name;
            const source = path.join(folder, entry.name);
            if (entry.isDirectory()) await upload(source, key);
            else if (entry.isFile()) {
              await s3.send(new PutObjectCommand({ Bucket: env.r2.bucket, Key: key,
                Body: fs.createReadStream(source), ContentLength: fs.statSync(source).size }));
              restoredKeys.add(key);
            }
          }
        };
        await upload(files);
        for (const key of await objects(s3, env.r2.bucket)) {
          if (!key.startsWith(PREFIX) && !restoredKeys.has(key)) {
            await s3.send(new DeleteObjectCommand({ Bucket: env.r2.bucket, Key: key }));
          }
        }
      }
      await prisma.userSession.updateMany({ data: { isActive: false } });
      // The pre-restore e-signature is lost when MongoDB is replaced; preserve that
      // verified record in the restored database before logging completion.
      await prisma.electronicSignature.create({ data: signature });
      await recordEvent({ action: 'BACKUP_RESTORED', entityType: 'Backup', entityId: fileName,
        newValue: { triggeredBy, filesCount: manifest.filesCount, safetyBackup: safety.file, signatureId: signature.id } });
      logger.warn(`Full backup restored: ${fileName} (by ${triggeredBy})`);
      return { file: fileName, restoredAt: new Date().toISOString(), filesCount: manifest.filesCount };
    });
  } finally { busy = false; }
}
