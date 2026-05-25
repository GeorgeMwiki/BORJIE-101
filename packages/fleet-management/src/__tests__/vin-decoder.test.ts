/**
 * VIN decoder — calls the NHTSA vPIC API. Test stubs the fetch path.
 */
import { describe, it, expect } from 'vitest';
import { decodeVin, VinDecodeError } from '../vehicles/vin-decoder.js';

function makeFetch(body: unknown, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    async json() {
      return body;
    },
  });
}

describe('vin-decoder / decodeVin', () => {
  it('rejects malformed VINs', async () => {
    await expect(decodeVin('123', { fetch: makeFetch({}) })).rejects.toThrow(VinDecodeError);
    await expect(decodeVin('1IO0OQ0II0Q', { fetch: makeFetch({}) })).rejects.toThrow(VinDecodeError);
  });

  it('decodes a valid NHTSA response and normalises taxonomy', async () => {
    const vin = '1HGCM82633A123456';
    const fetchSpy = makeFetch({
      Results: [
        {
          Make: 'TOYOTA',
          Model: 'HILUX',
          ModelYear: '2022',
          BodyClass: 'Truck — Light (Pickup)',
          FuelTypePrimary: 'Diesel',
          EngineCylinders: '4',
          DisplacementL: '2.4',
          PlantCountry: 'JAPAN',
        },
      ],
    });
    const spec = await decodeVin(vin, { fetch: fetchSpy });
    expect(spec.source).toBe('nhtsa');
    expect(spec.make).toBe('TOYOTA');
    expect(spec.year).toBe(2022);
    expect(spec.type).toBe('pickup');
    expect(spec.fuelType).toBe('diesel');
    expect(spec.engineCylinders).toBe(4);
    expect(spec.displacementL).toBeCloseTo(2.4, 2);
  });

  it('caches subsequent decodes', async () => {
    const cache = new Map();
    let calls = 0;
    const fetchSpy = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            Results: [{ Make: 'Honda', Model: 'Civic', ModelYear: '2020', BodyClass: 'Sedan', FuelTypePrimary: 'Gasoline' }],
          };
        },
      };
    };
    await decodeVin('1HGCM82633A123456', { fetch: fetchSpy, cache });
    const second = await decodeVin('1HGCM82633A123456', { fetch: fetchSpy, cache });
    expect(calls).toBe(1);
    expect(second.source).toBe('cache');
  });

  it('returns a stub on failure when stubOnFailure=true', async () => {
    const fetchSpy = makeFetch({}, false, 500);
    const spec = await decodeVin('1HGCM82633A123456', { fetch: fetchSpy, stubOnFailure: true });
    expect(spec.source).toBe('stub');
    expect(spec.type).toBe('unknown');
  });

  it('throws on failure when stubOnFailure is not set', async () => {
    const fetchSpy = makeFetch({}, false, 500);
    await expect(decodeVin('1HGCM82633A123456', { fetch: fetchSpy })).rejects.toThrow(VinDecodeError);
  });

  it('falls back to current year when ModelYear is malformed', async () => {
    const fetchSpy = makeFetch({
      Results: [{ Make: 'Ford', Model: 'Transit', ModelYear: 'unknown', BodyClass: 'Van', FuelTypePrimary: 'Gasoline' }],
    });
    const spec = await decodeVin('1HGCM82633A123456', { fetch: fetchSpy });
    expect(spec.year).toBe(new Date().getFullYear());
    expect(spec.type).toBe('van');
    expect(spec.fuelType).toBe('petrol');
  });
});
