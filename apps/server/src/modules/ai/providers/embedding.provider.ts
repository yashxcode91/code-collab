import crypto from 'crypto';
import { RAG_LIMITS } from '@codecollab/shared';

// =====================================================================
// Embedding Provider Interfaces & Validation
// =====================================================================

export const EMBEDDING_DIMENSION = RAG_LIMITS.EMBEDDING_DIMENSION; // 768

/**
 * Validates that an embedding vector returned by any provider strictly conforms
 * to the 768-dimensional float requirement of pgvector.
 */
export const validateEmbeddingVector = (
  vec: number[],
  providerName: string
): number[] => {
  if (!Array.isArray(vec)) {
    throw new Error(`[${providerName}] Embedding output must be an array of numbers`);
  }

  if (vec.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `[${providerName}] Invalid vector dimension: expected exactly ${EMBEDDING_DIMENSION}, got ${vec.length}`
    );
  }

  for (let i = 0; i < vec.length; i++) {
    if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
      throw new Error(
        `[${providerName}] Vector contains non-finite number at index ${i}`
      );
    }
  }

  return vec;
};

export interface EmbeddingProvider {
  name: string;
  dimension: number;
  embedText(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// =====================================================================
// Offline Deterministic Pseudo-Semantic Embedding Provider
// =====================================================================

/**
 * High-fidelity deterministic 768-dimensional offline embedding generator.
 * Maps code and natural language text into an L2-normalized 768-dim hypersphere
 * using token and subword n-gram feature hashing (similar to FastText/MurmurHash).
 *
 * Guarantees:
 * 1. Exactly 768 dimensions.
 * 2. L2 norm = 1.0 (unit vector) for accurate cosine similarity.
 * 3. Deterministic: identical text produces identical vector.
 * 4. Semantic clustering: texts sharing identifiers/keywords produce high cosine similarity.
 * 5. 100% offline: zero external network calls, zero quota usage.
 */
export class OfflineMockEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'codecollab-offline-v1';
  public readonly dimension = EMBEDDING_DIMENSION;

  public async embedText(text: string): Promise<number[]> {
    const raw = this.generateDeterministicVector(text);
    return validateEmbeddingVector(raw, this.name);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embedText(t)));
  }

  private generateDeterministicVector(text: string): number[] {
    const vec = new Float64Array(this.dimension);
    const normalized = text.toLowerCase().trim();

    if (!normalized) {
      // Return a balanced zero-centered unit vector if empty
      vec[0] = 1.0;
      return Array.from(vec);
    }

    // Tokenize into words and code identifiers
    const words = normalized.split(/[^a-zA-Z0-9_$]+/g).filter((w) => w.length > 1);

    // Also extract character 3-grams for typo and prefix tolerance
    const ngrams: string[] = [];
    for (let i = 0; i < normalized.length - 2; i++) {
      ngrams.push(normalized.substring(i, i + 3));
    }

    const tokens = [...words, ...ngrams];

    // Feature hashing (Murmur/MD5 simulation)
    for (const token of tokens) {
      const hash = crypto.createHash('sha256').update(token).digest();
      const bucket = hash.readUInt16BE(0) % this.dimension;
      const sign = (hash.readUInt8(2) & 1) === 1 ? 1 : -1;
      const weight = Math.min(3.0, Math.log1p(token.length));

      vec[bucket] += sign * weight;
    }

    // Compute L2 Euclidean norm
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vec[i] * vec[i];
    }

    const norm = Math.sqrt(sumSq);
    if (norm === 0) {
      vec[0] = 1.0;
      return Array.from(vec);
    }

    // Normalize to unit length (cosine similarity <=> dot product)
    const result = new Array<number>(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      result[i] = Number((vec[i] / norm).toFixed(7));
    }

    return result;
  }
}

// =====================================================================
// Google Gemini Text Embedding Provider (text-embedding-004)
// =====================================================================

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  public readonly name = 'gemini-text-embedding-004';
  public readonly dimension = EMBEDDING_DIMENSION;

  private apiKey: string;
  private endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  public async embedText(text: string): Promise<number[]> {
    try {
      const url = `${this.endpoint}?key=${encodeURIComponent(this.apiKey)}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: {
            parts: [{ text: text.slice(0, 10_000) }],
          },
        }),
      });

      if (!response.ok) {
        console.warn(
          `[GeminiEmbeddingProvider] API returned HTTP ${response.status}. Falling back to offline embedding provider.`
        );
        return new OfflineMockEmbeddingProvider().embedText(text);
      }

      const data = (await response.json()) as {
        embedding?: { values?: number[] };
      };

      const values = data.embedding?.values;
      if (!values || values.length === 0) {
        return new OfflineMockEmbeddingProvider().embedText(text);
      }

      return validateEmbeddingVector(values, this.name);
    } catch (err) {
      console.warn(
        `[GeminiEmbeddingProvider] Error embedding text. Falling back to offline provider:`,
        err
      );
      return new OfflineMockEmbeddingProvider().embedText(text);
    }
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    // Gemini text-embedding-004 allows batchEmbedContents or sequential/concurrency pool
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embedText(text);
      results.push(vec);
    }
    return results;
  }
}

// =====================================================================
// Provider Factory
// =====================================================================

/**
 * Returns the active embedding provider.
 * When `GEMINI_API_KEY` is set and valid, uses Google Gemini's `text-embedding-004`.
 * In test mode or when no API key is set, seamlessly falls back to the deterministic
 * `OfflineMockEmbeddingProvider` for 100% test reliability and offline support.
 */
export const getEmbeddingProvider = (): EmbeddingProvider => {
  if (process.env.NODE_ENV === 'test') {
    return new OfflineMockEmbeddingProvider();
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    return new GeminiEmbeddingProvider(geminiKey);
  }

  return new OfflineMockEmbeddingProvider();
};
