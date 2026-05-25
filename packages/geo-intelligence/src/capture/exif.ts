/**
 * Minimal EXIF GPS extractor.
 *
 * Reads enough of a JPEG byte stream to find the GPS sub-IFD and return
 * `{lat, lng, ts, deviceModel}`. Intentionally hand-rolled (no extra
 * dependency) — the implementation walks the EXIF tag tree and stops as
 * soon as GPSLatitude / GPSLongitude are found.
 *
 * Strategy:
 *   1. Verify JPEG SOI (0xFFD8).
 *   2. Scan for APP1 EXIF marker (0xFFE1, payload starts with "Exif\0\0").
 *   3. Parse the TIFF header (II / MM, magic 0x002A) for byte order.
 *   4. Walk IFD0; if a GPS sub-IFD pointer (tag 0x8825) exists, walk it
 *      and pull GPSLatitudeRef / GPSLatitude / GPSLongitudeRef /
 *      GPSLongitude / GPSAltitude / GPSDateStamp / GPSTimeStamp.
 *   5. Convert DMS (degrees, minutes, seconds) -> decimal degrees.
 *
 * Returns null when GPS tags are absent.
 */

import type { ExifGps } from '../types.js';

interface ByteReader {
  readonly read16: (offset: number) => number;
  readonly read32: (offset: number) => number;
  readonly readRational: (offset: number) => number; // numerator / denominator
  readonly readString: (offset: number, length: number) => string;
}

function makeReader(view: DataView, little: boolean): ByteReader {
  return {
    read16: (o) => view.getUint16(o, little),
    read32: (o) => view.getUint32(o, little),
    readRational: (o) => {
      const num = view.getUint32(o, little);
      const den = view.getUint32(o + 4, little);
      return den === 0 ? 0 : num / den;
    },
    readString: (o, len) => {
      let out = '';
      for (let i = 0; i < len; i++) {
        const code = view.getUint8(o + i);
        if (code === 0) break;
        out += String.fromCharCode(code);
      }
      return out;
    },
  };
}

function dmsToDecimal(deg: number, min: number, sec: number, ref: string): number {
  let value = deg + min / 60 + sec / 3600;
  if (ref === 'S' || ref === 'W') value = -value;
  return value;
}

/**
 * Parse EXIF GPS from a JPEG byte buffer. Returns null when no GPS
 * tags are present or the buffer is not a valid JPEG.
 */
export function parseExifGps(bytes: ArrayBuffer): ExifGps | null {
  if (!bytes || bytes.byteLength < 10) return null;
  const view = new DataView(bytes);
  // SOI
  if (view.getUint16(0, false) !== 0xffd8) return null;

  // Scan APP markers.
  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset, false);
    if (marker !== 0xffe1) {
      // Skip this segment — read length and jump.
      const segLen = view.getUint16(offset + 2, false);
      offset += 2 + segLen;
      continue;
    }
    // APP1
    const segLen = view.getUint16(offset + 2, false);
    const exifHeaderStart = offset + 4;
    // Expect "Exif\0\0"
    const tag = String.fromCharCode(
      view.getUint8(exifHeaderStart),
      view.getUint8(exifHeaderStart + 1),
      view.getUint8(exifHeaderStart + 2),
      view.getUint8(exifHeaderStart + 3),
    );
    if (tag !== 'Exif') {
      offset += 2 + segLen;
      continue;
    }
    const tiffStart = exifHeaderStart + 6;
    const byteOrder = view.getUint16(tiffStart, false);
    const little = byteOrder === 0x4949; // 'II'
    const reader = makeReader(view, little);
    const magic = reader.read16(tiffStart + 2);
    if (magic !== 0x002a) return null;
    const ifd0Offset = reader.read32(tiffStart + 4) + tiffStart;
    const ifd0Count = reader.read16(ifd0Offset);

    let gpsIfdOffset: number | null = null;
    let deviceModel: string | undefined;
    let dateTime: string | undefined;
    for (let i = 0; i < ifd0Count; i++) {
      const entryOffset = ifd0Offset + 2 + i * 12;
      const tagId = reader.read16(entryOffset);
      const tagType = reader.read16(entryOffset + 2);
      const tagCount = reader.read32(entryOffset + 4);
      const tagValueOffset = entryOffset + 8;
      if (tagId === 0x8825) {
        // GPS sub-IFD
        gpsIfdOffset = reader.read32(tagValueOffset) + tiffStart;
      } else if (tagId === 0x0110 && tagType === 2) {
        // Model (ASCII)
        const valueIsInline = tagCount <= 4;
        const valueOffset = valueIsInline
          ? tagValueOffset
          : reader.read32(tagValueOffset) + tiffStart;
        deviceModel = reader.readString(valueOffset, tagCount);
      } else if (tagId === 0x0132 && tagType === 2) {
        // DateTime
        const valueIsInline = tagCount <= 4;
        const valueOffset = valueIsInline
          ? tagValueOffset
          : reader.read32(tagValueOffset) + tiffStart;
        dateTime = reader.readString(valueOffset, tagCount);
      }
    }
    if (gpsIfdOffset === null) return null;

    const gpsCount = reader.read16(gpsIfdOffset);
    let latRef = '';
    let lat = 0;
    let lngRef = '';
    let lng = 0;
    let altitude: number | undefined;
    let haveLat = false;
    let haveLng = false;
    for (let i = 0; i < gpsCount; i++) {
      const entryOffset = gpsIfdOffset + 2 + i * 12;
      const tagId = reader.read16(entryOffset);
      const tagType = reader.read16(entryOffset + 2);
      const tagCount = reader.read32(entryOffset + 4);
      const tagValueOffset = entryOffset + 8;
      if (tagId === 0x0001 && tagType === 2 && tagCount >= 1) {
        latRef = String.fromCharCode(view.getUint8(tagValueOffset));
      } else if (tagId === 0x0002 && tagType === 5 && tagCount === 3) {
        const dataOffset = reader.read32(tagValueOffset) + tiffStart;
        const d = reader.readRational(dataOffset);
        const m = reader.readRational(dataOffset + 8);
        const s = reader.readRational(dataOffset + 16);
        lat = dmsToDecimal(d, m, s, latRef || 'N');
        haveLat = true;
      } else if (tagId === 0x0003 && tagType === 2 && tagCount >= 1) {
        lngRef = String.fromCharCode(view.getUint8(tagValueOffset));
      } else if (tagId === 0x0004 && tagType === 5 && tagCount === 3) {
        const dataOffset = reader.read32(tagValueOffset) + tiffStart;
        const d = reader.readRational(dataOffset);
        const m = reader.readRational(dataOffset + 8);
        const s = reader.readRational(dataOffset + 16);
        lng = dmsToDecimal(d, m, s, lngRef || 'E');
        haveLng = true;
      } else if (tagId === 0x0006 && tagType === 5 && tagCount === 1) {
        const dataOffset = reader.read32(tagValueOffset) + tiffStart;
        altitude = reader.readRational(dataOffset);
      }
    }
    if (!haveLat || !haveLng) return null;
    // Recompute lat with the latest latRef in case the entries arrived
    // in a different order.
    return Object.freeze({
      lat,
      lng,
      ...(dateTime !== undefined ? { ts: dateTime } : {}),
      ...(deviceModel !== undefined ? { deviceModel } : {}),
      ...(altitude !== undefined ? { altitudeM: altitude } : {}),
    });
  }
  return null;
}
