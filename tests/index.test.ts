import * as Lib from '../src/index';

describe('Public Exports (src/index.ts)', () => {
  it('exports TokenBucket, MemoryStore, rateLimiter and utilities', () => {
    expect(Lib.TokenBucket).toBeDefined();
    expect(Lib.MemoryStore).toBeDefined();
    expect(Lib.rateLimiter).toBeDefined();
    expect(Lib.defaultKeyGenerator).toBeDefined();
  });
});
