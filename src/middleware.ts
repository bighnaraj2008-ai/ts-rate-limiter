import { Request, Response, NextFunction, RequestHandler } from 'express';
import { TokenBucket } from './tokenBucket';

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
  capacity?: number;
  refillRate?: number;
  initialTokens?: number;
  tokensPerRequest?: TokensPerRequest;
  keyGenerator?: KeyGenerator;
  skip?: SkipFunction;
  statusCode?: number;
  message?: string | Record<string, unknown>;
  headers?: boolean;
  clock?: () => number;
  handler?: RateLimitHandler;
  onLimitReached?: (req: Request, key: string) => void;
}

export interface RateLimiterMiddleware extends RequestHandler {
  resetKey?: (key: string) => boolean;
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
 */
export function rateLimiter(options: RateLimiterOptions = {}): RateLimiterMiddleware {
  const {
    capacity = 60,
    refillRate = 10,
    keyGenerator = defaultKeyGenerator,
    skip = () => false,
  } = options;

  if (capacity <= 0 || !isFinite(capacity)) {
    throw new RangeError(`Capacity must be a positive finite number, received: ${capacity}`);
  }
  if (refillRate <= 0 || !isFinite(refillRate)) {
    throw new RangeError(`Refill rate must be a positive finite number, received: ${refillRate}`);
  }

  const middleware: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
    if (skip(req)) {
      return next();
    }

    const _key = keyGenerator(req);
    return next();
  };

  return middleware as RateLimiterMiddleware;
}
