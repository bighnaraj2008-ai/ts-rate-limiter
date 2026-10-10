# ts-rate-limiter

> A production-grade, highly-performant API rate limiter middleware in TypeScript powered by the Token Bucket algorithm.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-48%20passing-brightgreen.svg)]()
[![Coverage](https://img.shields.io/badge/Coverage-99.4%25-brightgreen.svg)]()

`ts-rate-limiter` provides both a standalone, zero-dependency `TokenBucket` algorithm class and a fully configurable Express middleware. It supports dynamic time-based token refills, burst traffic handling, per-client keys, memory leak prevention via automatic stale-bucket eviction, and standard HTTP rate-limiting headers.

---

## Table of Contents

- [Features](#features)
- [How the Token Bucket Algorithm Works](#how-the-token-bucket-algorithm-works)
- [Installation](#installation)
- [Quick Start with Express](#quick-start-with-express)
- [Usage Examples](#usage-examples)
  - [1. Rate Limiting by API Key or Header](#1-rate-limiting-by-api-key-or-header)
  - [2. Dynamic Cost per Request](#2-dynamic-cost-per-request)
  - [3. Skipping Specific Routes (e.g., Health Checks)](#3-skipping-specific-routes-eg-health-checks)
  - [4. Custom 429 Error Response or Handler](#4-custom-429-error-response-or-handler)
  - [5. Standalone TokenBucket Class (No Express Required)](#5-standalone-tokenbucket-class-no-express-required)
- [HTTP Headers](#http-headers)
- [Configuration Reference](#configuration-reference)
  - [`RateLimiterOptions`](#ratelimiteroptions)
  - [`TokenBucket` API](#tokenbucket-api)
- [Production Memory Management](#production-memory-management)
- [Development & Testing](#development--testing)
- [License](#license)

---

## Features

- **Strict Token Bucket Algorithm**: Supports burst traffic while enforcing smooth average throughput.
- **Zero Background Timers for Buckets**: Dynamic time-delta calculation on request; no per-bucket timers or memory leaks.
- **Express Middleware**: Drop-in middleware with standard `429 Too Many Requests` responses and RFC-compliant headers.
- **Informative Headers**: Automatic `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After`.
- **Custom Key Generators**: Rate limit by IP address, API key, JWT subject, user ID, or custom route parameters.
- **Dynamic Request Cost**: Charge variable tokens per request (e.g. lightweight reads cost 1 token, heavy batch exports cost 5 tokens).
- **Stale Bucket Eviction**: Built-in `MemoryStore` automatically purges inactive client buckets to maintain constant memory footprint.
- **Custom Storage Interface**: Easily plug in distributed stores (e.g. Redis).
- **100% TypeScript**: Strongly typed with strict mode enabled and complete `.d.ts` declarations.

---

## How the Token Bucket Algorithm Works

The Token Bucket algorithm models rate limiting using a bucket that holds tokens up to a maximum **capacity**.

```
    Tokens added at refillRate (tokens / sec)
                 │
                 ▼
          ┌─────────────┐
          │  ● ● ● ● ●  │  ◄── Capacity (maximum burst)
          │   ● ● ● ●   │
          │    ● ● ●    │
          └──────┬──────┘
                 │
                 ▼
      Request consumes N tokens
          (Allowed if tokens >= N, rejected otherwise)
```

1. **Bucket Capacity ($B$)**: The maximum number of tokens the bucket can hold at any given time. This defines the maximum allowable burst.
2. **Refill Rate ($r$)**: The rate at which new tokens are continuously added to the bucket (in tokens per second).
3. **Dynamic Refill**: Rather than running constant timers, token replenishment is calculated on demand when an action occurs:
   $$\Delta t = t_{\text{current}} - t_{\text{lastUpdated}}$$
   $$\text{tokensToAdd} = \Delta t \times r$$
   $$\text{tokens} = \min(B, \text{tokens} + \text{tokensToAdd})$$
4. **Consumption**: If the requested number of tokens is available, they are deducted and the request proceeds. If not, the request is rejected with HTTP 429.

---

## Installation

```bash
npm install ts-rate-limiter
```

Or clone and build from source:

```bash
git clone <repo-url>
cd ts-rate-limiter
npm install
npm run build
```

---

## Quick Start with Express

```typescript
import express from 'express';
import { rateLimiter } from 'ts-rate-limiter';

const app = express();

// Apply global rate limiting: 60 requests burst capacity, refilling at 10 tokens/second
app.use(
  rateLimiter({
    capacity: 60,
    refillRate: 10,
  })
);

app.get('/api/data', (req, res) => {
  res.json({
    message: 'Hello World!',
    rateLimit: req.rateLimit,
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Usage Examples

### 1. Rate Limiting by API Key or Header

Limit clients based on their `X-API-Key` header instead of their IP address:

```typescript
import { rateLimiter } from 'ts-rate-limiter';

app.use(
  '/api/',
  rateLimiter({
    capacity: 100,
    refillRate: 20, // 20 tokens per second
    keyGenerator: (req) => {
      const apiKey = req.headers['x-api-key'];
      return typeof apiKey === 'string' ? apiKey : req.ip || 'anonymous';
    },
  })
);
```

### 2. Dynamic Cost per Request

Charge different token costs depending on the computational weight of an endpoint:

```typescript
app.use(
  rateLimiter({
    capacity: 50,
    refillRate: 5,
    tokensPerRequest: (req) => {
      // Expensive export operations consume 10 tokens; simple reads consume 1
      if (req.path.endsWith('/export')) return 10;
      if (req.query.batch === 'true') return 5;
      return 1;
    },
  })
);
```

### 3. Skipping Specific Routes (e.g., Health Checks)

Bypass rate limiting for internal health checks or whitelisted IPs:

```typescript
app.use(
  rateLimiter({
    capacity: 30,
    refillRate: 5,
    skip: (req) => {
      return req.path === '/health' || req.ip === '127.0.0.1';
    },
  })
);
```

### 4. Custom 429 Error Response or Handler

Provide a customized JSON payload or custom handler function:

```typescript
app.use(
  rateLimiter({
    capacity: 10,
    refillRate: 2,
    statusCode: 429,
    message: {
      status: 'error',
      code: 'RATE_LIMIT_EXCEEDED',
      detail: 'You have sent too many requests. Please slow down.',
    },
    onLimitReached: (req, key) => {
      console.warn(`[RateLimit] Limit reached for client key: ${key}`);
    },
  })
);
```

You can also specify a custom handler function:

```typescript
app.use(
  rateLimiter({
    capacity: 10,
    refillRate: 1,
    handler: (req, res, next, options) => {
      res.status(429).json({
        error: 'Custom handler response',
        retryAfter: res.getHeader('Retry-After'),
      });
    },
  })
);
```

### 5. Standalone TokenBucket Class (No Express Required)

The `TokenBucket` class can be used independently for background job queues, microservices, CLI tools, or web crawlers:

```typescript
import { TokenBucket } from 'ts-rate-limiter';

// Create a bucket with capacity of 5, refilling at 1 token every 2 seconds (0.5 tokens/sec)
const bucket = new TokenBucket({
  capacity: 5,
  refillRate: 0.5,
});

if (bucket.consume(1)) {
  console.log('Action allowed! Tokens remaining:', bucket.getTokensRemaining());
} else {
  const waitMs = bucket.getTimeUntilTokensAvailable(1);
  console.log(`Rate limit exceeded! Please wait ${waitMs}ms before retrying.`);
}
```

---

## HTTP Headers

When `headers: true` (default), `ts-rate-limiter` automatically sets the following HTTP response headers:

| Header | Description | Example |
| :--- | :--- | :--- |
| `X-RateLimit-Limit` | Maximum token burst capacity of the client's bucket | `60` |
| `X-RateLimit-Remaining` | Number of whole tokens remaining for the current client | `42` |
| `X-RateLimit-Reset` | Unix timestamp (in seconds) when requested tokens replenish | `1773322105` |
| `Retry-After` | Seconds to wait before retrying (sent on 429 responses) | `2` |

---

## Configuration Reference

### `RateLimiterOptions`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `capacity` | `number` | `60` | Maximum burst capacity of the token bucket. |
| `refillRate` | `number` | `10` | Number of tokens refilled per second. |
| `initialTokens` | `number` | `capacity` | Initial tokens present in a newly created bucket. |
| `tokensPerRequest` | `number \| ((req: Request) => number)` | `1` | Tokens consumed per request (static or dynamic). |
| `keyGenerator` | `(req: Request) => string` | `IP / x-forwarded-for` | Custom identifier for client bucketing. |
| `skip` | `(req: Request) => boolean` | `() => false` | Return `true` to bypass rate limiting for a request. |
| `statusCode` | `number` | `429` | HTTP status code sent on rate limit violations. |
| `message` | `string \| object` | Standard 429 JSON | Payload sent on rate limit violations. |
| `headers` | `boolean` | `true` | Whether to send `X-RateLimit-*` and `Retry-After` headers. |
| `store` | `TokenBucketStore` | `new MemoryStore()` | Underlying bucket storage instance. |
| `handler` | `RateLimitHandler` | `undefined` | Custom handler overriding default response. |
| `onLimitReached` | `(req: Request, key: string) => void` | `undefined` | Callback fired when a client exceeds rate limits. |
| `clock` | `() => number` | `Date.now` | Clock function returning current time in ms (for testing). |

### `TokenBucket` API

| Method / Property | Return Type | Description |
| :--- | :--- | :--- |
| `consume(tokens?: number)` | `boolean` | Atomically consumes tokens if available. Returns `true` if allowed. |
| `getTokensRemaining()` | `number` | Returns up-to-date token count after time-based refill. |
| `currentTokens` | `number` | Getter alias for `getTokensRemaining()`. |
| `lastUpdated` | `number` | Epoch millisecond timestamp of the last refill/update. |
| `getTimeUntilTokensAvailable(tokens?: number)` | `number` | Milliseconds remaining until `tokens` will be available. |
| `getResetTimestampInSeconds(tokens?: number)` | `number` | Unix timestamp (seconds) when tokens will be available. |
| `reset()` | `void` | Refills the bucket back to full capacity immediately. |

---

## Production Memory Management

In production servers exposed to the open internet, unique IP addresses can number in the millions. Storing buckets indefinitely in an unbounded map creates memory leaks.

`ts-rate-limiter` includes a built-in `MemoryStore` that:
- Automatically tracks `lastAccessed` timestamps for every bucket.
- Runs an unref'd background cleanup interval (default: 60s) to prune buckets inactive for longer than `maxInactiveAgeMs` (default: 5 minutes).
- Because `unref()` is called on the cleanup interval, it will never prevent Node.js from exiting cleanly during graceful shutdown.

```typescript
import { MemoryStore, rateLimiter } from 'ts-rate-limiter';

const store = new MemoryStore({
  cleanupIntervalMs: 30000, // Check every 30 seconds
  maxInactiveAgeMs: 120000,  // Evict buckets idle for 2 minutes
});

app.use(rateLimiter({ store }));
```

---

## Development & Testing

Run all unit tests with full coverage:

```bash
# Run Jest test suite
npm test

# Run tests in watch mode
npm run test:watch

# Compile TypeScript to dist/
npm run build

# Type check without emitting files
npm run typecheck
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
