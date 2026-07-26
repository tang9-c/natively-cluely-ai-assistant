import {
  QCLOUD_EMBEDDING_BACKING_MODEL,
  QCLOUD_EMBEDDING_MODEL,
  QCLOUD_EMBEDDINGS_ENDPOINT,
} from '../../llm/QCloudLlmConstants';
import { embeddingSpaceKey } from '../embeddingSpace';
import type { EmbedOptions, IEmbeddingProvider } from './IEmbeddingProvider';

interface QCloudEmbeddingItem {
  index?: unknown;
  embedding?: unknown;
}

interface QCloudEmbeddingResponse {
  data?: unknown;
}

export class QCloudEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'qcloud';
  readonly model = QCLOUD_EMBEDDING_BACKING_MODEL;
  private detectedDimensions = 0;

  constructor(private readonly apiKey: string) {}

  get dimensions(): number {
    return this.detectedDimensions;
  }

  get space(): string {
    return embeddingSpaceKey({
      name: this.name,
      model: this.model,
      dimensions: this.dimensions,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const vector = await this.embed('test');
      return vector.length > 0;
    } catch {
      return false;
    }
  }

  async embed(text: string, _opts?: EmbedOptions): Promise<number[]> {
    const [vector] = await this.request(text, 1);
    return vector;
  }

  async embedQuery(text: string, opts?: EmbedOptions): Promise<number[]> {
    return this.embed(text, opts);
  }

  async embedBatch(texts: string[], _opts?: EmbedOptions): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    return this.request(texts, texts.length);
  }

  private async request(input: string | string[], expectedCount: number): Promise<number[][]> {
    let response: Response;
    try {
      response = await fetch(QCLOUD_EMBEDDINGS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: QCLOUD_EMBEDDING_MODEL,
          input,
        }),
      });
    } catch {
      throw new Error('QCLOUD embedding request failed due to a transport error');
    }

    if (!response.ok) {
      throw new Error(`QCLOUD embedding request failed with HTTP ${response.status}`);
    }

    let payload: QCloudEmbeddingResponse;
    try {
      payload = await response.json() as QCloudEmbeddingResponse;
    } catch {
      throw new Error('QCLOUD embedding response was not valid JSON');
    }

    if (!Array.isArray(payload.data) || payload.data.length !== expectedCount) {
      throw new Error('QCLOUD embedding response had an invalid item count');
    }

    const ordered = new Array<number[]>(expectedCount);
    for (const rawItem of payload.data as QCloudEmbeddingItem[]) {
      if (
        !Number.isInteger(rawItem?.index)
        || (rawItem.index as number) < 0
        || (rawItem.index as number) >= expectedCount
        || ordered[rawItem.index as number] !== undefined
        || !Array.isArray(rawItem.embedding)
        || rawItem.embedding.length === 0
        || !rawItem.embedding.every(value => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new Error('QCLOUD embedding response contained an invalid vector');
      }
      ordered[rawItem.index as number] = rawItem.embedding as number[];
    }

    const dimensions = ordered[0]?.length ?? 0;
    if (
      dimensions === 0
      || ordered.some(vector => !vector || vector.length !== dimensions)
    ) {
      throw new Error('QCLOUD embedding response contained inconsistent dimensions');
    }

    this.detectedDimensions = dimensions;
    return ordered;
  }
}
