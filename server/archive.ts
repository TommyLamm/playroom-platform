import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { isSafePath, manifestSchema, type GameManifest } from '../shared/manifest.js';
import { AppError } from './errors.js';

export type ArchiveLimits = { maxZipBytes: number; maxExpandedBytes: number; maxFiles: number };

export async function validateDirectory(root: string): Promise<GameManifest> {
  const manifestFile = path.join(root, 'game.json');
  const stat = await fsp.stat(manifestFile).catch(() => null);
  if (!stat?.isFile() || stat.size > 64 * 1024)
    throw new AppError(400, '遊戲包必須在根目錄包含 game.json（最多 64 KB）');
  let json: unknown;
  try {
    json = JSON.parse(await fsp.readFile(manifestFile, 'utf8'));
  } catch {
    throw new AppError(400, 'game.json 不是有效的 JSON');
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success)
    throw new AppError(
      400,
      `game.json 格式錯誤：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  for (const filename of [parsed.data.entry, parsed.data.cover]) {
    if (!(await fsp.stat(path.join(root, filename)).catch(() => null))?.isFile())
      throw new AppError(400, `找不到遊戲檔案：${filename}`);
  }
  if ((await fsp.stat(path.join(root, parsed.data.cover))).size > 5 * 1024 * 1024)
    throw new AppError(400, '封面不可超過 5 MB');
  return parsed.data;
}

export async function extractArchive(
  zipPath: string,
  destination: string,
  limits: ArchiveLimits,
): Promise<GameManifest> {
  if ((await fsp.stat(zipPath)).size > limits.maxZipBytes)
    throw new AppError(400, '遊戲包超過壓縮大小限制');
  await fsp.mkdir(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      zipPath,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (openError, zip) => {
        if (openError || !zip) {
          reject(new AppError(400, '無法讀取 ZIP 遊戲包'));
          return;
        }
        let settled = false;
        let count = 0;
        let expanded = 0;
        let declared = 0;
        const names = new Set<string>();
        const fail = (error: unknown) => {
          if (settled) return;
          settled = true;
          zip.close();
          reject(
            error instanceof AppError ? error : new AppError(400, 'ZIP 已損壞或包含無法解壓的檔案'),
          );
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          void (async () => {
            const directory = entry.fileName.endsWith('/');
            const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
            if (!isSafePath(name) || name.length > 240)
              throw new AppError(400, 'ZIP 包含不安全的檔案路徑');
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode && mode !== 0x8000 && mode !== 0x4000)
              throw new AppError(400, 'ZIP 不允許符號連結或特殊檔案');
            if (entry.generalPurposeBitFlag & 1) throw new AppError(400, 'ZIP 不允許加密檔案');
            if (++count > limits.maxFiles) throw new AppError(400, 'ZIP 檔案數量超過限制');
            declared += entry.uncompressedSize;
            if (declared > limits.maxExpandedBytes) throw new AppError(400, 'ZIP 解壓大小超過限制');
            const key = name.toLowerCase();
            if (names.has(key)) throw new AppError(400, 'ZIP 包含重複的檔案路徑');
            names.add(key);
            const target = path.join(destination, ...name.split('/'));
            if (directory) {
              await fsp.mkdir(target, { recursive: true });
            } else {
              await fsp.mkdir(path.dirname(target), { recursive: true });
              const stream = await new Promise<import('node:stream').Readable>((res, rej) =>
                zip.openReadStream(entry, (error, value) =>
                  error || !value ? rej(error) : res(value),
                ),
              );
              await pipeline(
                stream,
                new Transform({
                  transform(chunk, _encoding, callback) {
                    expanded += chunk.length;
                    callback(
                      expanded > limits.maxExpandedBytes
                        ? new AppError(400, 'ZIP 解壓大小超過限制')
                        : null,
                      chunk,
                    );
                  },
                }),
                fs.createWriteStream(target, { flags: 'wx' }),
              );
            }
            if (!settled) zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      },
    );
  });
  return validateDirectory(destination);
}
