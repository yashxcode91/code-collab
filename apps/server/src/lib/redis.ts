import { createHmac, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

// Read connection URL from environment or default to local Docker Redis port
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const validateRedisProductionConfig = (): void => {
  if (process.env.NODE_ENV !== 'production') return;
  let parsed: URL;
  try {
    parsed = new URL(REDIS_URL);
  } catch {
    throw new Error('REDIS_URL must be a valid URL in production');
  }
  if (!parsed.password) {
    throw new Error('REDIS_URL must configure authentication credentials in production');
  }
  const secret = process.env.EXECUTION_PUBSUB_SECRET?.trim() ?? '';
  if (secret.length < 32) {
    throw new Error(
      'EXECUTION_PUBSUB_SECRET (min 32 chars) must be configured in production'
    );
  }
};

export const getExecutionPubSubSecret = (): string | null => {
  const raw = process.env.EXECUTION_PUBSUB_SECRET?.trim();
  return raw && raw.length > 0 ? raw : null;
};

export const canonicalJsonStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(record[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const signPubSubString = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

export const verifyPubSubStringSignature = (
  payload: string,
  signatureHex: string,
  secret: string
): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return false;
  const expectedHex = signPubSubString(payload, secret);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(signatureHex.toLowerCase(), 'hex');
  if (expectedBuf.byteLength !== providedBuf.byteLength) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
};

validateRedisProductionConfig();

/**
 * Shared Redis command client instance (Singleton Pattern).
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

/**
 * Creates a dedicated Redis connection configured for BullMQ (`maxRetriesPerRequest: null`),
 * preventing blocking queue commands from failing on transient reconnects.
 */
export const createBullMqConnection = (): Redis => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on('error', (err) => {
    console.error('⚠️ BullMQ Redis connection error:', err.message);
  });
  return client;
};

/**
 * Creates an isolated Redis Pub/Sub subscriber client (`SUBSCRIBE` puts ioredis into
 * subscriber mode so it must stay separate from the shared command client).
 */
export const createRedisSubscriber = (): Redis => {
  const subscriber = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  subscriber.on('error', (err) => {
    console.error('⚠️ Redis subscriber connection error:', err.message);
  });
  return subscriber;
};

export const closeRedisClient = async (client: Redis): Promise<void> => {
  if (client.status === 'ready') {
    await client.quit();
  } else {
    client.disconnect();
  }
};
