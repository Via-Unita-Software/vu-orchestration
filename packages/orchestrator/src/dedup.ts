import type { Redis } from 'ioredis';

export class DedupService {
  constructor(private readonly redis: Redis, private readonly defaultTtl: number = 300) {}

  async isDuplicate(key: string, ttlSeconds?: number): Promise<boolean> {
    const ttl = ttlSeconds ?? this.defaultTtl;
    const result = await this.redis.set(`dedup:${key}`, '1', 'EX', ttl, 'NX');
    return result === null; // null = key already existed = duplicate
  }
}
