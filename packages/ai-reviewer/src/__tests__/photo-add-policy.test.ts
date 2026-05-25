import { describe, it, expect } from 'vitest';
import { photoAddPolicy } from '../policies/photo-add-policy.js';
import { makeReq } from './fixtures.js';

describe('photoAddPolicy', () => {
  it('preChecks reports empty photo list', () => {
    const issues = photoAddPolicy.preChecks(makeReq('photo_add', { photos: [] }));
    expect(issues.some((i) => i.code === 'photo.list.empty')).toBe(true);
  });

  it('preChecks rejects zero-byte photo', () => {
    const issues = photoAddPolicy.preChecks(
      makeReq('photo_add', {
        photos: [{ filename: 'a.jpg', mime: 'image/jpeg', bytes: 0 }],
      }),
    );
    expect(issues.some((i) => i.code === 'photo.bytes.zero')).toBe(true);
  });

  it('preChecks rejects unsupported MIME', () => {
    const issues = photoAddPolicy.preChecks(
      makeReq('photo_add', {
        photos: [{ filename: 'a.tiff', mime: 'image/tiff', bytes: 1024 }],
      }),
    );
    expect(issues.some((i) => i.code === 'photo.mime.unsupported')).toBe(true);
  });

  it('redLines blocks oversized photo', () => {
    const redLines = photoAddPolicy.redLines(
      makeReq('photo_add', {
        photos: [{ filename: 'big.jpg', mime: 'image/jpeg', bytes: 25 * 1024 * 1024 }],
      }),
    );
    expect(redLines.some((i) => i.code === 'photo.bytes.exceeds_cap')).toBe(true);
  });

  it('redLines blocks executable/archive extensions', () => {
    const redLines = photoAddPolicy.redLines(
      makeReq('photo_add', {
        photos: [{ filename: 'sneaky.exe', mime: 'image/jpeg', bytes: 1024 }],
      }),
    );
    expect(
      redLines.some((i) => i.code === 'photo.extension.executable_or_archive'),
    ).toBe(true);
  });
});
