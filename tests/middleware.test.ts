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

  describe('Integration Suite Skeleton', () => {
    let app: Express;

    beforeEach(() => {
      app = express();
      const limiter = rateLimiter({
        capacity: 5,
        refillRate: 1,
        store: new MemoryStore({ clock: mockClock }),
        clock: mockClock,
        keyGenerator: () => 'skeleton-client',
      });

      app.use(limiter);
      app.get('/ping', (_req: Request, res: Response) => {
        res.json({ status: 'ok' });
      });
    });

    it('creates test application with rate limiter middleware attached', async () => {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });
});
