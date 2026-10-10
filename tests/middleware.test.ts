import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { rateLimiter } from '../src/middleware';
import { MemoryStore } from '../src/store';

describe('Express Rate Limiter Middleware', () => {
  let currentTime: number;
  const mockClock = () => currentTime;

  beforeEach(() => {
    currentTime = 1000000;
  });

  describe('Standard Consumption & Headers', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      const limiter = rateLimiter({
        capacity: 3,
        refillRate: 1, // 1 token per second
        clock: mockClock,
        keyGenerator: () => 'test-client',
      });

      app.use(limiter);
      app.get('/api/test', (req: Request, res: Response) => {
        res.json({ message: 'success', rateLimit: req.rateLimit });
      });
    });

    it('allows requests within capacity and sets correct X-RateLimit headers', async () => {
      // 1st request (consumes 1, 2 remaining)
      const res1 = await request(app).get('/api/test');
      expect(res1.status).toBe(200);
      expect(res1.headers['x-ratelimit-limit']).toBe('3');
      expect(res1.headers['x-ratelimit-remaining']).toBe('2');
      expect(res1.headers['x-ratelimit-reset']).toBeDefined();
      expect(res1.body.rateLimit).toEqual({
        limit: 3,
        remaining: 2,
        resetTime: expect.any(Number),
      });

      // 2nd request (consumes 1, 1 remaining)
      const res2 = await request(app).get('/api/test');
      expect(res2.status).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('1');

      // 3rd request (consumes 1, 0 remaining)
      const res3 = await request(app).get('/api/test');
      expect(res3.status).toBe(200);
      expect(res3.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('returns HTTP 429 with standard headers and error payload when limit is exceeded', async () => {
      // Exhaust capacity
      await request(app).get('/api/test');
      await request(app).get('/api/test');
      await request(app).get('/api/test');

      // 4th request -> Rate limited!
      const res4 = await request(app).get('/api/test');
      expect(res4.status).toBe(429);
      expect(res4.headers['x-ratelimit-limit']).toBe('3');
      expect(res4.headers['x-ratelimit-remaining']).toBe('0');
      expect(res4.headers['retry-after']).toBe('1'); // At 1 token/sec, 1 sec needed
      expect(res4.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
      });
    });

    it('allows requests again once bucket has refilled', async () => {
      // Exhaust capacity
      await request(app).get('/api/test');
      await request(app).get('/api/test');
      await request(app).get('/api/test');

      // Fails
      const blocked = await request(app).get('/api/test');
      expect(blocked.status).toBe(429);

      // Advance time by 2 seconds -> refilled 2 tokens
      currentTime += 2000;

      const allowedAgain = await request(app).get('/api/test');
      expect(allowedAgain.status).toBe(200);
      expect(allowedAgain.headers['x-ratelimit-remaining']).toBe('1');
    });
  });

  describe('Custom Key Generator (e.g. API Key or User ID)', () => {
    it('isolates rate limits per client key', async () => {
      const app = express();
      const limiter = rateLimiter({
        capacity: 2,
        refillRate: 1,
        clock: mockClock,
        keyGenerator: (req) => (req.headers['x-api-key'] as string) || 'anonymous',
      });

      app.use(limiter);
      app.get('/data', (_req, res) => res.send('ok'));

      // Client A exhausts their limit
      await request(app).get('/data').set('x-api-key', 'client-A');
      await request(app).get('/data').set('x-api-key', 'client-A');
      const clientABlocked = await request(app).get('/data').set('x-api-key', 'client-A');
      expect(clientABlocked.status).toBe(429);

      // Client B has their own separate bucket and should succeed
      const clientB1 = await request(app).get('/data').set('x-api-key', 'client-B');
      expect(clientB1.status).toBe(200);
      const clientB2 = await request(app).get('/data').set('x-api-key', 'client-B');
      expect(clientB2.status).toBe(200);

      // Client B now exhausts limit
      const clientBBlocked = await request(app).get('/data').set('x-api-key', 'client-B');
      expect(clientBBlocked.status).toBe(429);
    });

    it('defaults key generator to ip or x-forwarded-for header', async () => {
      const app = express();
      const limiter = rateLimiter({
        capacity: 1,
        refillRate: 1,
        clock: mockClock,
      });

      app.use(limiter);
      app.get('/ip-test', (_req, res) => res.send('ok'));

      const res1 = await request(app)
        .get('/ip-test')
        .set('x-forwarded-for', '203.0.113.195, 70.41.3.18');
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/ip-test')
        .set('x-forwarded-for', '203.0.113.195, 70.41.3.18');
      expect(res2.status).toBe(429);
    });
  });

  describe('Tokens Per Request', () => {
    it('supports static tokensPerRequest configuration', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 10,
          refillRate: 1,
          tokensPerRequest: 4,
          clock: mockClock,
          keyGenerator: () => 'static-cost-user',
        })
      );
      app.get('/heavy', (_req, res) => res.send('heavy action'));

      // 1st request consumes 4 -> 6 remaining
      const r1 = await request(app).get('/heavy');
      expect(r1.status).toBe(200);
      expect(r1.headers['x-ratelimit-remaining']).toBe('6');

      // 2nd request consumes 4 -> 2 remaining
      const r2 = await request(app).get('/heavy');
      expect(r2.status).toBe(200);
      expect(r2.headers['x-ratelimit-remaining']).toBe('2');

      // 3rd request needs 4, but only 2 available -> blocked!
      const r3 = await request(app).get('/heavy');
      expect(r3.status).toBe(429);
    });

    it('supports dynamic tokensPerRequest function based on request', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 10,
          refillRate: 1,
          tokensPerRequest: (req) => (req.query.batch === 'true' ? 6 : 2),
          clock: mockClock,
          keyGenerator: () => 'dynamic-cost-user',
        })
      );
      app.get('/query', (_req, res) => res.send('done'));

      // Standard request consumes 2 -> 8 remaining
      const r1 = await request(app).get('/query');
      expect(r1.headers['x-ratelimit-remaining']).toBe('8');

      // Batch request consumes 6 -> 2 remaining
      const r2 = await request(app).get('/query?batch=true');
      expect(r2.headers['x-ratelimit-remaining']).toBe('2');

      // Next batch needs 6, only 2 left -> 429
      const r3 = await request(app).get('/query?batch=true');
      expect(r3.status).toBe(429);
    });
  });

  describe('Custom Responses & Handlers', () => {
    it('supports custom status code and custom string message', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 1,
          refillRate: 1,
          statusCode: 420,
          message: 'Chill out, too fast!',
          clock: mockClock,
          keyGenerator: () => 'custom-msg-user',
        })
      );
      app.get('/chill', (_req, res) => res.send('ok'));

      await request(app).get('/chill');
      const r2 = await request(app).get('/chill');
      expect(r2.status).toBe(420);
      expect(r2.text).toBe('Chill out, too fast!');
    });

    it('supports custom JSON object message', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 1,
          refillRate: 1,
          message: { success: false, code: 'RATE_LIMIT_REACHED' },
          clock: mockClock,
          keyGenerator: () => 'json-user',
        })
      );
      app.get('/json', (_req, res) => res.send('ok'));

      await request(app).get('/json');
      const r2 = await request(app).get('/json');
      expect(r2.status).toBe(429);
      expect(r2.body).toEqual({ success: false, code: 'RATE_LIMIT_REACHED' });
    });

    it('invokes custom handler and onLimitReached callback', async () => {
      const onLimitReachedMock = jest.fn();
      const customHandlerMock = jest.fn((_req, res) => {
        res.status(429).send('Custom rate limit page');
      });

      const app = express();
      app.use(
        rateLimiter({
          capacity: 1,
          refillRate: 1,
          clock: mockClock,
          keyGenerator: () => 'handler-user',
          handler: customHandlerMock,
          onLimitReached: onLimitReachedMock,
        })
      );
      app.get('/hook', (_req, res) => res.send('ok'));

      await request(app).get('/hook');
      const r2 = await request(app).get('/hook');

      expect(r2.status).toBe(429);
      expect(r2.text).toBe('Custom rate limit page');
      expect(onLimitReachedMock).toHaveBeenCalledTimes(1);
      expect(customHandlerMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Skip Functionality & Header Toggling', () => {
    it('skips rate limiting when skip() returns true', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 1,
          refillRate: 1,
          skip: (req) => req.path === '/health',
          clock: mockClock,
          keyGenerator: () => 'skip-user',
        })
      );
      app.get('/health', (_req, res) => res.send('healthy'));
      app.get('/normal', (_req, res) => res.send('normal'));

      // Health checks bypass limiter and have no headers attached
      for (let i = 0; i < 5; i++) {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      }

      // Normal route is rate limited
      await request(app).get('/normal');
      const blocked = await request(app).get('/normal');
      expect(blocked.status).toBe(429);
    });

    it('omits headers when headers option is set to false', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 1,
          refillRate: 1,
          headers: false,
          clock: mockClock,
          keyGenerator: () => 'no-headers-user',
        })
      );
      app.get('/no-headers', (_req, res) => res.send('ok'));

      const r1 = await request(app).get('/no-headers');
      expect(r1.headers['x-ratelimit-limit']).toBeUndefined();
      expect(r1.headers['x-ratelimit-remaining']).toBeUndefined();
      expect(r1.headers['x-ratelimit-reset']).toBeUndefined();

      const r2 = await request(app).get('/no-headers');
      expect(r2.status).toBe(429);
      expect(r2.headers['retry-after']).toBeUndefined();
    });
  });

  describe('Middleware Utilities & Error Validation', () => {
    it('allows manually resetting a client key via middleware.resetKey', async () => {
      const app = express();
      const limiter = rateLimiter({
        capacity: 1,
        refillRate: 0.1,
        clock: mockClock,
        keyGenerator: () => 'resettable-key',
      });

      app.use(limiter);
      app.get('/resettable', (_req, res) => res.send('ok'));

      await request(app).get('/resettable');
      const blocked = await request(app).get('/resettable');
      expect(blocked.status).toBe(429);

      // Reset the key
      const deleted = limiter.resetKey('resettable-key');
      expect(deleted).toBe(true);

      // Now request succeeds again immediately
      const allowedAfterReset = await request(app).get('/resettable');
      expect(allowedAfterReset.status).toBe(200);
    });

    it('supports custom store instance', async () => {
      const customStore = new MemoryStore({ clock: mockClock });
      const app = express();
      const limiter = rateLimiter({
        capacity: 2,
        refillRate: 1,
        store: customStore,
        clock: mockClock,
        keyGenerator: () => 'store-key',
      });

      app.use(limiter);
      app.get('/store-test', (_req, res) => res.send('ok'));

      await request(app).get('/store-test');
      expect(customStore.has('store-key')).toBe(true);
      expect(customStore.size()).toBe(1);

      customStore.destroy();
    });

    it('throws RangeError during setup for invalid options', () => {
      expect(() => rateLimiter({ capacity: 0 })).toThrow(RangeError);
      expect(() => rateLimiter({ refillRate: -1 })).toThrow(RangeError);
    });

    it('throws RangeError when tokensPerRequest is negative', async () => {
      const app = express();
      app.use(
        rateLimiter({
          tokensPerRequest: -1,
        })
      );
      app.get('/invalid-cost', (_req, res) => res.send('ok'));

      const res = await request(app).get('/invalid-cost');
      expect(res.status).toBe(500);
    });

    it('supports custom initialTokens option', async () => {
      const app = express();
      app.use(
        rateLimiter({
          capacity: 5,
          refillRate: 1,
          initialTokens: 1,
          clock: mockClock,
          keyGenerator: () => 'init-user',
        })
      );
      app.get('/init', (_req, res) => res.send('ok'));

      // 1st request succeeds, consuming the single initial token
      const r1 = await request(app).get('/init');
      expect(r1.status).toBe(200);
      expect(r1.headers['x-ratelimit-remaining']).toBe('0');

      // 2nd request immediately fails
      const r2 = await request(app).get('/init');
      expect(r2.status).toBe(429);
    });

    it('works with default parameters without arguments', async () => {
      const app = express();
      const limiter = rateLimiter();
      app.use(limiter);
      app.get('/defaults', (_req, res) => res.send('ok'));

      const res = await request(app).get('/defaults');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('60');
      expect(res.headers['x-ratelimit-remaining']).toBe('59');
    });

    it('handles defaultKeyGenerator array headers, remoteAddress, and fallback', () => {
      const { defaultKeyGenerator } = require('../src/middleware');

      // Array x-forwarded-for
      const reqArray = { headers: { 'x-forwarded-for': [' 10.0.0.1 ', '10.0.0.2'] } } as any;
      expect(defaultKeyGenerator(reqArray)).toBe('10.0.0.1');

      // socket remoteAddress
      const reqSocket = { headers: {}, socket: { remoteAddress: '192.168.1.1' } } as any;
      expect(defaultKeyGenerator(reqSocket)).toBe('192.168.1.1');

      // Fallback
      const reqEmpty = { headers: {} } as any;
      expect(defaultKeyGenerator(reqEmpty)).toBe('127.0.0.1');
    });
  });
});
