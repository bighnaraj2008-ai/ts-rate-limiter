import { Request, Response, NextFunction, RequestHandler } from 'express';
import { TokenBucket } from './tokenBucket';
import { TokenBucketStore, MemoryStore } from './store';

export interface RateLimitInfo {
  /** Maximum number of tokens (capacity) */
  limit: number;
  /** Tokens remaining in the bucket (floored integer) */
  remaining: number;
  /** Unix timestamp in seconds when the required tokens will be replenished */
  resetTime: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rateLimit?: RateLimitInfo;
    }
  }
}

export type KeyGenerator = (req: Request) => string;
export type SkipFunction = (req: Request) => boolean;
export type TokensPerRequest = number | ((req: Request) => number);
export type RateLimitHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  options: RateLimiterOptions
) => void | Promise<void>;

export interface RateLimiterOptions {
  /** Maximum token burst capacity. Defaults to 60. */
  capacity?: number;
  /** Token refill rate per second. Defaults to 10. */
  refillRate?: number;
  /** Initial tokens available when a new bucket is created. Defaults to capacity. */
  initialTokens?: number;
  /** Number of tokens to consume per request (or dynamic function). Defaults to 1. */
  tokensPerRequest?: TokensPerRequest;
  /** Custom key generator (e.g. by IP or header). Defaults to client IP. */
  keyGenerator?: KeyGenerator;
  /** Function to determine if rate limiting should be skipped for this request. */
  skip?: SkipFunction;
  /** HTTP status code to return when rate limit is exceeded. Defaults to 429. */
  statusCode?: number;
  /** Custom error message or JSON object for 429 responses. */
  message?: string | Record<string, unknown>;
  /** Whether to set standard X-RateLimit-* and Retry-After headers. Defaults to true. */
  headers?: boolean;
  /** Storage engine for buckets. Defaults to in-memory store with stale eviction. */
  store?: TokenBucketStore;
  /** Custom clock returning milliseconds (defaults to Date.now). Useful for testing. */
  clock?: () => number;
  /** Custom handler when rate limit is exceeded. Overrides default JSON response. */
  handler?: RateLimitHandler;
  /** Optional callback fired when a rate limit is exceeded. Useful for metrics/logging. */
  onLimitReached?: (req: Request, key: string) => void;
}

export interface RateLimiterMiddleware extends RequestHandler {
  /** Underlying bucket storage */
  store: TokenBucketStore;
  /** Resets or deletes a specific rate limit key */
  resetKey: (key: string) => boolean;
}

/**
 * Default key generator extracting client IP address.
 */
export const defaultKeyGenerator: KeyGenerator = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  } else if (Array.isArray(forwarded) && forwarded[0]) {
    return forwarded[0].trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );
};

/**
 * Creates an Express rate-limiting middleware powered by the Token Bucket algorithm.
 *
 * @param options Rate limiter configuration options.
 * @returns Express RequestHandler with additional store inspection utilities.
 */
export function rateLimiter(options: RateLimiterOptions = {}): RateLimiterMiddleware {
  const {
    capacity = 60,
    refillRate = 10,
    initialTokens,
    tokensPerRequest = 1,
    keyGenerator = defaultKeyGenerator,
    skip = () => false,
    statusCode = 429,
    message = {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
    },
    headers = true,
    store = new MemoryStore(),
    clock = () => Date.now(),
    handler,
    onLimitReached,
  } = options;

  if (capacity <= 0 || !isFinite(capacity)) {
    throw new RangeError(`Capacity must be a positive finite number, received: ${capacity}`);
  }
  if (refillRate <= 0 || !isFinite(refillRate)) {
    throw new RangeError(`Refill rate must be a positive finite number, received: ${refillRate}`);
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    let bucket = store.get(key);

    if (!bucket) {
      bucket = new TokenBucket({
        capacity,
        refillRate,
        initialTokens: initialTokens ?? capacity,
        clock,
      });
      store.set(key, bucket);
    }

    const cost =
      typeof tokensPerRequest === 'function' ? tokensPerRequest(req) : tokensPerRequest;

    if (cost < 0 || isNaN(cost)) {
      throw new RangeError(`tokensPerRequest must be non-negative, received: ${cost}`);
    }

    const allowed = bucket.consume(cost);
    const tokensRemaining = bucket.getTokensRemaining();
    const flooredRemaining = Math.max(0, Math.floor(tokensRemaining));
    const resetTimestamp = bucket.getResetTimestampInSeconds(cost > 0 ? cost : 1);

    req.rateLimit = {
      limit: capacity,
      remaining: flooredRemaining,
      resetTime: resetTimestamp,
    };

    if (headers && !res.headersSent) {
      res.setHeader('X-RateLimit-Limit', capacity.toString());
      res.setHeader('X-RateLimit-Remaining', flooredRemaining.toString());
      res.setHeader('X-RateLimit-Reset', resetTimestamp.toString());
    }

    if (allowed) {
      return next();
    }

    // Rate limit violated
    if (onLimitReached) {
      onLimitReached(req, key);
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(bucket.getTimeUntilTokensAvailable(cost > 0 ? cost : 1) / 1000)
    );

    if (headers && !res.headersSent) {
      res.setHeader('Retry-After', retryAfterSeconds.toString());
    }

    if (handler) {
      handler(req, res, next, options);
      return;
    }

    if (typeof message === 'string') {
      res.status(statusCode).send(message);
    } else {
      res.status(statusCode).json(message);
    }
  };

  const rateLimiterMiddleware = middleware as RateLimiterMiddleware;
  rateLimiterMiddleware.store = store;
  rateLimiterMiddleware.resetKey = (key: string): boolean => {
    return store.delete(key);
  };

  return rateLimiterMiddleware;
}
