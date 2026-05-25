/**
 * Opus encode/decode façade.
 *
 * We expose `encodeOpus` / `decodeOpus` plus a `setOpusRunner` injection
 * point. The default runner emits a deterministic header + payload that
 * round-trips losslessly through `decodeOpus`. Real deployments call
 * `setOpusRunner({ encode, decode })` once at boot with a libopus port
 * (e.g. opus-recorder, OggOpusEncoder, or @discordjs/opus).
 */

export interface OpusRunner {
  encode(pcm: Uint8Array): Uint8Array;
  decode(opus: Uint8Array): Uint8Array;
}

const TAG = new Uint8Array([0x4f, 0x70, 0x75, 0x53]); // "OpuS"

let runner: OpusRunner = {
  encode(pcm) {
    const out = new Uint8Array(TAG.byteLength + 4 + pcm.byteLength);
    out.set(TAG, 0);
    new DataView(out.buffer).setUint32(TAG.byteLength, pcm.byteLength, true);
    out.set(pcm, TAG.byteLength + 4);
    return out;
  },
  decode(bytes) {
    if (bytes.byteLength < TAG.byteLength + 4) {
      throw new Error('opus payload too short');
    }
    for (let i = 0; i < TAG.byteLength; i += 1) {
      if (bytes[i] !== TAG[i]) throw new Error('opus tag mismatch');
    }
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + TAG.byteLength,
      4,
    );
    const length = view.getUint32(0, true);
    return bytes.slice(TAG.byteLength + 4, TAG.byteLength + 4 + length);
  },
};

export function encodeOpus(pcm: Uint8Array): Uint8Array {
  return runner.encode(pcm);
}

export function decodeOpus(opus: Uint8Array): Uint8Array {
  return runner.decode(opus);
}

export function setOpusRunner(newRunner: OpusRunner): void {
  runner = newRunner;
}
