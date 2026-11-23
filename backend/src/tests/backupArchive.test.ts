import fs from 'fs';
import os from 'os';
import path from 'path';
import { gzipSync } from 'zlib';
import { extractBackupTar } from '../utils/backupArchive';

const tar = require('tar-stream');

async function bundle(entries: Array<{ name: string; type?: string; linkname?: string; content?: string }>) {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => { pack.on('end', () => resolve(gzipSync(Buffer.concat(chunks)))); pack.on('error', reject); });
  for (const entry of entries) pack.entry({ name: entry.name, type: entry.type ?? 'file', linkname: entry.linkname }, entry.content ?? '');
  pack.finalize();
  return finished;
}

describe('untrusted backup archives', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izlearn-archive-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function extract(entries: Parameters<typeof bundle>[0]) {
    const archive = path.join(dir, 'test.tar.gz');
    const target = path.join(dir, 'extracted');
    fs.mkdirSync(target);
    fs.writeFileSync(archive, await bundle(entries));
    return extractBackupTar(archive, target);
  }

  it.each(['../outside', '/absolute', 'C:/outside', 'dir/../../outside', 'dir\\outside'])('rejects traversal path %s', async (name) => {
    await expect(extract([{ name }])).rejects.toThrow('unsafe archive path');
  });
  it.each(['symlink', 'link', 'fifo'])('rejects %s entries', async (type) => {
    await expect(extract([{ name: 'entry', type, linkname: '../outside' }])).rejects.toThrow('special files');
  });
  it('rejects duplicate file paths', async () => {
    await expect(extract([{ name: 'a' }, { name: './a' }])).rejects.toThrow('duplicate');
  });
  it('extracts ordinary nested files', async () => {
    expect(await extract([{ name: './materials/guide.pdf', content: 'PDF' }])).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'extracted/materials/guide.pdf'), 'utf8')).toBe('PDF');
  });
  it('rejects an oversized PAX metadata declaration before the tar parser buffers it', async () => {
    const header = Buffer.alloc(512);
    header.write('pax-header');
    header.write('00010000000\0', 124, 'ascii');
    header[156] = 'x'.charCodeAt(0);
    const archive = path.join(dir, 'metadata.tar.gz');
    fs.writeFileSync(archive, gzipSync(header));
    await expect(extractBackupTar(archive, path.join(dir, 'extracted'))).rejects.toThrow('metadata is too large');
  });
});
