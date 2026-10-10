import { MemoryStore } from '../src/store';
import { TokenBucket } from '../src/tokenBucket';

describe('MemoryStore', () => {
  let currentTime: number;
  const mockClock = () => currentTime;

  beforeEach(() => {
    currentTime = 500000;
  });

  it('stores and retrieves TokenBucket instances', () => {
    const store = new MemoryStore({ clock: mockClock });
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });

    store.set('user:1', bucket);
    expect(store.has('user:1')).toBe(true);
    expect(store.get('user:1')).toBe(bucket);
    expect(store.size()).toBe(1);

    store.destroy();
  });

  it('deletes and clears buckets', () => {
    const store = new MemoryStore({ clock: mockClock });
    const bucket1 = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });
    const bucket2 = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });

    store.set('user:1', bucket1);
    store.set('user:2', bucket2);
    expect(store.size()).toBe(2);

    expect(store.delete('user:1')).toBe(true);
    expect(store.has('user:1')).toBe(false);
    expect(store.size()).toBe(1);

    store.clear();
    expect(store.size()).toBe(0);

    store.destroy();
  });

  it('updates lastAccessed timestamp when accessing existing keys', () => {
    const store = new MemoryStore({ clock: mockClock, maxInactiveAgeMs: 1000 });
    const bucket = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });

    store.set('key', bucket);

    // Advance time by 800ms
    currentTime += 800;
    // Access key, which refreshes lastAccessed to 500800
    expect(store.get('key')).toBe(bucket);

    // Advance time by another 500ms (1300ms from start, but only 500ms since last access)
    currentTime += 500;
    const evicted = store.cleanup(1000);
    expect(evicted).toBe(0);
    expect(store.has('key')).toBe(true);

    // Advance time by 1100ms past last access
    currentTime += 1100;
    const evictedNow = store.cleanup(1000);
    expect(evictedNow).toBe(1);
    expect(store.has('key')).toBe(false);

    store.destroy();
  });

  it('cleans up inactive entries correctly', () => {
    const store = new MemoryStore({ clock: mockClock, maxInactiveAgeMs: 5000 });
    const b1 = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });
    const b2 = new TokenBucket({ capacity: 10, refillRate: 1, clock: mockClock });

    store.set('active', b1);
    store.set('stale', b2);

    currentTime += 6000;
    store.get('active'); // active is refreshed to 506000

    // Stale was last accessed at 500000, 6000ms ago (> 5000ms)
    const evicted = store.cleanup(5000);
    expect(evicted).toBe(1);
    expect(store.has('active')).toBe(true);
    expect(store.has('stale')).toBe(false);

    store.destroy();
  });

  it('stops timers on destroy()', () => {
    const store = new MemoryStore({ cleanupIntervalMs: 1000, clock: mockClock });
    store.destroy();
    expect(store.size()).toBe(0);
  });
});
