import { createHmac, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const validateWorkerRedisConfig = (): void => {
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

export const getWorkerPubSubSecret = (): string | null => {
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

export const signWorkerPubSubString = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

export const verifyWorkerPubSubSignature = (
  payload: string,
  signatureHex: string,
  secret: string
): boolean => {
  if (!/^[a-f0-9]{64}$/i.test(signatureHex)) return false;
  const expectedHex = signWorkerPubSubString(payload, secret);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const providedBuf = Buffer.from(signatureHex.toLowerCase(), 'hex');
  if (expectedBuf.byteLength !== providedBuf.byteLength) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
};

validateWorkerRedisConfig();

export const getBullMqConnectionOptions = () => ({
  url: REDIS_URL,
  maxRetriesPerRequest: null,
});

export const redisPub = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redisPub.on('error', (err) => {
  console.error('⚠️ [worker] Redis publisher error:', err.message);
});

export const createWorkerSubscriber = (): Redis => {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  client.on('error', (err) => {
    console.error('⚠️ [worker] Redis subscriber error:', err.message);
  });
  return client;
};

export const closeRedisClient = async (client: Redis): Promise<void> => {
  if (client.status === 'ready') {
    await client.quit();
  } else {
    client.disconnect();
  }
};
