/**
 * MP3 façade — same injection pattern as Opus. Default runner emits a stub
 * "ID3" header + PCM payload so tests can verify round-trip framing.
 */

export interface Mp3Runner {
  encode(pcm: Uint8Array, sampleRate: number): Uint8Array;
}

const ID3 = new Uint8Array([0x49, 0x44, 0x33]); // "ID3"

let runner: Mp3Runner = {
  encode(pcm, sampleRate) {
    const out = new Uint8Array(ID3.byteLength + 4 + pcm.byteLength);
    out.set(ID3, 0);
    new DataView(out.buffer).setUint32(ID3.byteLength, sampleRate, true);
    out.set(pcm, ID3.byteLength + 4);
    return out;
  },
};

export function encodeMP3(pcm: Uint8Array, sampleRate: number): Uint8Array {
  return runner.encode(pcm, sampleRate);
}

export function setMp3Runner(newRunner: Mp3Runner): void {
  runner = newRunner;
}
