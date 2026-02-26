export type EmbeddingResult = {
  embedding: number[];
  index: number;
};

type OpenAIEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>;
};

export async function embedTexts(
  texts: string[],
  opts: { model: string; apiKey: string }
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // text-embedding-3-small supports up to 2048 inputs per call
  const BATCH_SIZE = 2048;
  const results: number[][] = new Array(texts.length);

  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({ model: opts.model, input: batch }),
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
