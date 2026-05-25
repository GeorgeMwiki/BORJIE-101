/**
 * Tiny ZIP writer used by the .docx and .pptx synthesizers.
 *
 * Mirrors the helper in `services/domain-services/src/documents/
 * renderers/docx-fallback-synthesizer.ts` — same code path, just
 * lifted into report-engine so the package has no cross-service
 * coupling. No external deps; uses node:zlib for deflate.
 *
 * Output is a valid PKZIP archive containing the entries the caller
 * supplies. OOXML packages (.docx, .pptx, .xlsx) are nothing more than
 * a ZIP of XML parts following a documented part-naming convention —
 * which is why this hand-rolled writer is enough.
 */

import { deflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

/** CRC-32 over the entry's uncompressed data. */
function crc32(buf: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c: number = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (table[idx] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Assemble a ZIP from entries. Each entry is DEFLATE-compressed.
 * Mod-time and mod-date are zeroed for deterministic output (handy
 * for snapshot tests / visual regression).
 */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local header sig
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralChunks.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }

  const local = Buffer.concat(localChunks);
  const central = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, central, end]);
}

/** Escape XML special characters in attribute / text values. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
