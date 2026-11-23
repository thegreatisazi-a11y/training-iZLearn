import fs from 'fs';
import path from 'path';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { deserialize } from 'bson';

interface Header { name: string; type: string; size: number }
const tar = require('tar-stream') as { extract(): Writable & {
  on(event: 'entry', callback: (header: Header, stream: Readable, next: (error?: Error) => void) => void): any;
} };

/** tar-stream buffers GNU/PAX metadata internally; cap it before it reaches the parser. */
function tarMetadataGuard() {
  let header = Buffer.alloc(0);
  let remaining = 0;
  let entries = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    try {
      let offset = 0;
      while (offset < chunk.length) {
        if (remaining) { const length = Math.min(remaining, chunk.length - offset); remaining -= length; offset += length; continue; }
        const length = Math.min(512 - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + length)]);
        offset += length;
        if (header.length < 512) continue;
        if (header.every((byte) => byte === 0)) { header = Buffer.alloc(0); continue; }
        if (++entries > 100000) throw new Error('Backup contains too many archive entries.');
        const sizeField = header.subarray(124, 136);
        let size: number;
        if (sizeField[0] & 0x80) {
          if (sizeField[0] & 0x40) throw new Error('Invalid archive size.');
          let binary = BigInt(sizeField[0] & 0x7f);
          for (const byte of sizeField.subarray(1)) binary = (binary << 8n) | BigInt(byte);
          size = Number(binary);
        } else {
          const octal = sizeField.toString('ascii').replace(/\0.*$/, '').trim();
          if (!/^[0-7]*$/.test(octal)) throw new Error('Invalid archive size.');
          size = parseInt(octal || '0', 8);
        }
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid archive size.');
        const type = String.fromCharCode(header[156]);
        if (['x', 'g', 'L', 'K'].includes(type) && size > 1024 ** 2) throw new Error('Archive metadata is too large.');
        remaining = Math.ceil(size / 512) * 512;
        header = Buffer.alloc(0);
      }
      callback(null, chunk);
    } catch (error) { callback(error as Error); }
  } });
}

export function archivePath(name: string): string {
  const relative = name.replace(/^\.\//, '').replace(/\/$/, '');
  if (relative === '' || relative === '.') return '';
  if (relative.startsWith('/') || /[\\:\x00-\x1f]/.test(relative) ||
      relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Backup contains an unsafe archive path.');
  }
  return relative;
}

/** Extract into a new private directory; never accept links, devices or duplicate paths. */
export async function extractBackupTar(file: string, destination: string, expected?: readonly string[]): Promise<number> {
  const extract = tar.extract();
  const seen = new Set<string>();
  let files = 0;
  let entries = 0;
  extract.on('entry', (header, stream, next) => {
    void (async () => {
      if (++entries > 100000) throw new Error('Backup contains too many archive entries.');
      const relative = archivePath(header.name);
      if (header.type !== 'file' && header.type !== 'directory') throw new Error('Backup links and special files are not allowed.');
      if (!Number.isSafeInteger(header.size) || header.size < 0) throw new Error('Invalid archive entry size.');
      if (expected && (!expected.includes(header.name) || header.type !== 'file')) throw new Error('Backup has unexpected archive paths.');
      const identity = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (seen.has(identity)) throw new Error('Backup contains duplicate archive paths.');
      seen.add(identity);
      if (!relative && header.type !== 'directory') throw new Error('Invalid archive root.');
      const target = path.join(destination, ...relative.split('/'));
      if (header.type === 'directory') {
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        stream.resume();
        await new Promise<void>((resolve, reject) => { stream.on('end', resolve); stream.on('error', reject); });
      } else {
        if (expected && header.name === 'manifest.json' && header.size > 1024 ** 2) throw new Error('Backup manifest is too large.');
        fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        await pipeline(stream, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        files++;
      }
    })().then(() => next(), (error) => extract.destroy(error));
  });
  await pipeline(fs.createReadStream(file), createGunzip(), tarMetadataGuard(), extract);
  if (expected && (files !== expected.length || expected.some((name) => !seen.has(name)))) throw new Error('Backup is missing required archive members.');
  return files;
}

/** Also check database gzip integrity without loading the archive into RAM. */
export async function verifyDatabaseGzip(file: string): Promise<string> {
  let pending = Buffer.alloc(0);
  let magic = false;
  let header = true;
  let complete = false;
  let metadataBytes = 0;
  const databases = new Set<string>();
  await pipeline(fs.createReadStream(file), createGunzip(),
    new Writable({ write(chunk: Buffer, _encoding, callback) {
      try {
        if (!complete) {
          pending = Buffer.concat([pending, chunk]);
          // Format defined by mongodb/mongo-tools/common/archive/prelude.go.
          if (!magic && pending.length >= 4) {
            if (pending.readUInt32LE(0) !== 0x8199e26d) throw new Error('Database is not a mongodump archive.');
            magic = true;
            pending = pending.subarray(4);
          }
          while (magic && pending.length >= 4 && !complete) {
            const length = pending.readInt32LE(0);
            if (length === -1) { complete = true; pending = Buffer.alloc(0); break; }
            if (length < 5 || length > 16 * 1024 ** 2) throw new Error('Invalid MongoDB archive metadata.');
            if (pending.length < length) break;
            metadataBytes += length;
            if (metadataBytes > 64 * 1024 ** 2) throw new Error('MongoDB archive metadata is too large.');
            const document = deserialize(pending.subarray(0, length));
            pending = pending.subarray(length);
            if (header) header = false;
            else {
              if (typeof document.db !== 'string' || !document.db || typeof document.collection !== 'string') throw new Error('Invalid MongoDB archive namespace.');
              databases.add(document.db);
            }
          }
        }
        callback();
      } catch (error) { callback(error as Error); }
    } }));
  if (!magic || header || !complete || databases.size !== 1) throw new Error('Backup must contain exactly one application database.');
  return [...databases][0];
}
