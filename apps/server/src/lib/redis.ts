import Redis from 'ioredis';

// Read connection URL from environment or default to local Docker Redis port
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Shared Redis client instance (Singleton Pattern).
 * Connects to our Docker Redis container on port 6379.
 */
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log('🔴 Redis client connected successfully');
});

redis.on('error', (err) => {
  console.error('⚠️ Redis connection error:', err.message);
});
