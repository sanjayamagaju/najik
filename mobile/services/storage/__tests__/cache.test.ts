import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearAllCaches, createCache, safeJsonParse } from '../cache';

const cache = createCache<{ n: number }>({
  key: 'test',
  version: 2,
  parse: (d) =>
    d && typeof d === 'object' && typeof (d as { n?: unknown }).n === 'number'
      ? (d as { n: number })
      : null,
});

beforeEach(() => AsyncStorage.clear());

describe('versioned cache', () => {
  it('round-trips for the same owner', async () => {
    await cache.write({ n: 1 }, 'u1');
    await expect(cache.read('u1')).resolves.toEqual({ n: 1 });
  });

  it('isolates owners', async () => {
    await cache.write({ n: 1 }, 'u1');
    await expect(cache.read('u2')).resolves.toBeNull();
  });

  it('discards entries from an older schema version', async () => {
    await AsyncStorage.setItem(
      cache.storageKey,
      JSON.stringify({ v: 1, owner: 'u1', savedAt: '', data: { n: 1 } }),
    );
    await expect(cache.read('u1')).resolves.toBeNull();
    await expect(AsyncStorage.getItem(cache.storageKey)).resolves.toBeNull();
  });

  it('survives corrupt JSON and invalid shapes', async () => {
    await AsyncStorage.setItem(cache.storageKey, '{oops');
    await expect(cache.read('u1')).resolves.toBeNull();
    await AsyncStorage.setItem(
      cache.storageKey,
      JSON.stringify({ v: 2, owner: 'u1', savedAt: '', data: { n: 'x' } }),
    );
    await expect(cache.read('u1')).resolves.toBeNull();
  });

  it('clearAllCaches only removes user caches', async () => {
    await cache.write({ n: 1 }, 'u1');
    await AsyncStorage.setItem('najik.device.settings', '{}');
    await clearAllCaches();
    expect(await AsyncStorage.getAllKeys()).toEqual(['najik.device.settings']);
  });

  it('safeJsonParse never throws', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('nope')).toBeUndefined();
    expect(safeJsonParse(null)).toBeUndefined();
  });
});
