import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { DedupService } from '../dedup.js';

describe('DedupService', () => {
  let dedup: DedupService;

  beforeEach(() => {
    dedup = new DedupService(new RedisMock() as any);
  });

  it('should return false for a new key', async () => {
    expect(await dedup.isDuplicate('key1')).toBe(false);
  });

  it('should return true for a duplicate key', async () => {
    await dedup.isDuplicate('key1');
    expect(await dedup.isDuplicate('key1')).toBe(true);
  });

  it('should treat different keys independently', async () => {
    await dedup.isDuplicate('key1');
    expect(await dedup.isDuplicate('key2')).toBe(false);
  });

  it('should use custom TTL when provided', async () => {
    const result = await dedup.isDuplicate('key3', 600);
    expect(result).toBe(false);
    // Second call should be duplicate
    expect(await dedup.isDuplicate('key3', 600)).toBe(true);
  });

  it('should prefix the key with dedup:', async () => {
    // Two services sharing the same redis mock - first writes 'key', second checks 'dedup:key'
    const redisMock = new RedisMock() as any;
    const svc = new DedupService(redisMock);
    await svc.isDuplicate('mykey');
    // The underlying key should be 'dedup:mykey'
    const val = await redisMock.get('dedup:mykey');
    expect(val).toBe('1');
  });
});
