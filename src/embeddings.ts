// ---------------------------------------------------------------------------
// Embedding provider interface + implementations
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// OpenAI API provider
// ---------------------------------------------------------------------------

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
};

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private model: string,
    private apiKey: string
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const BATCH_SIZE = 2048;
    const results: number[][] = new Array(texts.length);

    for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
      const batch = texts.slice(offset, offset + BATCH_SIZE);
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: batch }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenAI embeddings API error ${response.status}: ${text}`);
      }

      const json = (await response.json()) as OpenAIEmbeddingResponse;
      for (const item of json.data) {
        results[offset + item.index] = item.embedding;
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Local ONNX provider (requires @huggingface/transformers as optional dep)
// ---------------------------------------------------------------------------

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private model: string;
  private extractorPromise: Promise<unknown> | null = null;

  constructor(model: string = "Xenova/all-MiniLM-L6-v2") {
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const extractor = await this.getExtractor();

    // extractor is a FeatureExtractionPipeline
    const output = await (extractor as CallableFunction)(texts, {
      pooling: "mean",
      normalize: true,
    });

    const data = (output as { data: Float32Array; dims: number[] }).data;
    const dims = (output as { data: Float32Array; dims: number[] }).dims;
    const dim = dims[dims.length - 1];
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
    }

    return results;
  }

  private async getExtractor(): Promise<unknown> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.initExtractor();
    }
    return this.extractorPromise;
  }

  private async initExtractor(): Promise<unknown> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let transformers: { pipeline: any; env: { cacheDir: string } };
    try {
      // Dynamic import — @huggingface/transformers is an optional peer dep
      transformers = await (Function('return import("@huggingface/transformers")')() as Promise<typeof transformers>);
    } catch {
      throw new Error(
        "Local embedding backend requires @huggingface/transformers. " +
          "Install it: npm install @huggingface/transformers"
      );
    }

    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    transformers.env.cacheDir = join(homedir(), ".openclaw", "cache", "models");

    return transformers.pipeline("feature-extraction", this.model, {
      dtype: "q8",
    });
  }
}

// ---------------------------------------------------------------------------
// Cosine similarity (shared utility)
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
