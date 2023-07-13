import type { Collection } from 'chromadb';
import { ChromaClient, OpenAIEmbeddingFunction } from 'chromadb';

import { BaseVectorDB } from './BaseVectorDb';

const embedder = new OpenAIEmbeddingFunction({
  openai_api_key: process.env.OPENAI_API_KEY ?? '',
});

class ChromaDB extends BaseVectorDB {
  client: ChromaClient | undefined;

  collectionName: string;

  collection: Collection | null = null;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(collectionName?: string) {
    super();
    this.collectionName = collectionName ?? 'embedchain_store';
  }

  protected async getClientAndCollection(): Promise<void> {
    this.client = new ChromaClient({ path: 'http://localhost:8000' });
    try {
      this.collection = await this.client.getCollection({
        name: this.collectionName,
        embeddingFunction: embedder,
      });
    } catch (err) {
      if (!this.collection) {
        this.collection = await this.client.createCollection({
          name: this.collectionName,
          embeddingFunction: embedder,
        });
      }
    }
  }
}

export { ChromaDB };
