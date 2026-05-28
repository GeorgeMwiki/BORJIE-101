/**
 * Minimal in-memory ZIP writer (DEFLATE + STORE).
 *
 * Wave UNIVERSAL-DOC-DRAFTER. DOCX and PPTX files are ZIP archives of
 * OOXML parts. Rather than depend on `jszip` / `pizzip` (which are not
 * currently installed), this module writes the ZIP container directly
 * with Node's built-in `node:zlib` + `node:crypto` (CRC32 via lookup
 * table).
 *
 * Scope: ZIP64 is NOT supported; output is capped at ~4 GiB total and
 * 65,536 entries (sufficient for any document we generate). Single-byte
 * UTF-8 only for filenames (all our parts use ASCII names).
 */

import { deflateRawSync } from 'node:zlib';

const CRC32_TABLE: ReadonlyArray<number> = (() => {
  const t = new Array<number>(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    const byte = buf[i] ?? 0;
    c = (CRC32_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly name: string;
  readonly raw: Buffer;
  readonly compressed: Buffer;
  readonly method: 0 | 8;
  readonly crc: number;
  localHeaderOffset: number;
}

export interface ZipInput {
  readonly name: string;
  readonly data: string | Buffer;
  /** Force STORE method (no compression). Default DEFLATE. */
  readonly store?: boolean;
}

export function createZip(parts: ReadonlyArray<ZipInput>): Buffer {
  const entries: ZipEntry[] = [];
  for (const part of parts) {
    const raw = typeof part.data === 'string' ? Buffer.from(part.data, 'utf8') : part.data;
    const useStore = part.store === true;
    const compressed = useStore ? raw : deflateRawSync(raw);
    entries.push({
      name: part.name,
      raw,
      compressed,
      method: useStore ? 0 : 8,
      crc: crc32(raw),
      localHeaderOffset: 0,
    });
  }

  const chunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    entry.localHeaderOffset = offset;
    const local = buildLocalFileHeader(entry);
    chunks.push(local, entry.compressed);
    offset += local.length + entry.compressed.length;
  }
  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const entry of entries) {
    const c = buildCentralDirHeader(entry);
    chunks.push(c);
    centralDirSize += c.length;
  }
  const eocd = buildEndOfCentralDir(entries.length, centralDirSize, centralDirOffset);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

function buildLocalFileHeader(e: ZipEntry): Buffer {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // utf-8 flag
  header.writeUInt16LE(e.method, 8);
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(0, 12); // date
  header.writeUInt32LE(e.crc, 14);
  header.writeUInt32LE(e.compressed.length, 18);
  header.writeUInt32LE(e.raw.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBuf]);
}

function buildCentralDirHeader(e: ZipEntry): Buffer {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0x0800, 8); // utf-8 flag
  header.writeUInt16LE(e.method, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(e.crc, 16);
  header.writeUInt32LE(e.compressed.length, 20);
  header.writeUInt32LE(e.raw.length, 24);
  header.writeUInt16LE(nameBuf.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(e.localHeaderOffset, 42);
  return Buffer.concat([header, nameBuf]);
}

function buildEndOfCentralDir(
  total: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(total, 8);
  eocd.writeUInt16LE(total, 10);
  eocd.writeUInt32LE(centralSize, 14);
  eocd.writeUInt32LE(centralOffset, 18);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}
