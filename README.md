# ts-rate-limiter

> A production-grade, highly-performant API rate limiter middleware in TypeScript powered by the Token Bucket algorithm.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-48%20passing-brightgreen.svg)]()
[![Coverage](https://img.shields.io/badge/Coverage-99.4%25-brightgreen.svg)]()

`ts-rate-limiter` provides both a standalone, zero-dependency `TokenBucket` algorithm class and a fully configurable Express middleware. It supports dynamic time-based token refills, burst traffic handling, per-client keys, memory leak prevention via automatic stale-bucket eviction, and standard HTTP rate-limiting headers.

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
