import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isSafePath } from '../shared/manifest.js';
import type { Config } from './config.js';

export type FileDigest = { path: string; size: number; sha256: string };
export async function fileHash(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// All callers hold the platform lock (except immutable registered-file backup).
// Check each existing ancestor, including DATA_DIR, before touching a child.
export async function safeDataPath(dataDir: string, relative: string) {
  if (!isSafePath(relative)) throw new Error('Unsafe data path');
  const root = path.resolve(dataDir);
  const target = path.join(root, ...relative.split('/'));
  let current = path.parse(root).root;
  for (const part of path.relative(current, target).split(path.sep)) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error('Symbolic links are not permitted in data paths');
    if (stat && current !== target && !stat.isDirectory()) throw new Error('Invalid data ancestor');
  }
  return target;
}

export async function directoryInventory(root: string, limits: Pick<Config, 'maxFiles' | 'maxExpandedBytes'>, sync = false) {
  const files: FileDigest[] = [];
  const names = new Set<string>();
  let entries = 0, bytes = 0;
  async function walk(relative = '') {
    const directory = path.join(root, relative);
    if (!(await fsp.lstat(directory)).isDirectory()) throw new Error('Expected a directory');
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (!isSafePath(name) || name.length > 240 || names.has(name.toLowerCase())) throw new Error('Unsafe or duplicate file path');
      names.add(name.toLowerCase());
      if (++entries > limits.maxFiles) throw new Error('Too many files');
      const filename = path.join(root, ...name.split('/'));
      const stat = await fsp.lstat(filename);
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not permitted');
      if (stat.isDirectory()) await walk(name);
      else if (stat.isFile() && stat.nlink === 1) {
        bytes += stat.size;
        if (bytes > limits.maxExpandedBytes) throw new Error('Expanded size limit exceeded');
        files.push({ path: name, size: stat.size, sha256: await fileHash(filename) });
        // FlushFileBuffers on Windows requires a writable handle.
        if (sync) { const handle = await fsp.open(filename, 'r+'); try { await handle.sync(); } finally { await handle.close(); } }
      } else throw new Error('Special files and hard links are not permitted');
    }
    if (sync) await syncDirectory(directory);
  }
  await walk();
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function syncDirectory(directory: string) {
  // Windows does not expose fsync on directory handles; deployment uses Linux.
  if (process.platform === 'win32') return;
  const handle = await fsp.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
