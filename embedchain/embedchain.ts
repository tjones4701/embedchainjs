/* eslint-disable max-classes-per-file */
import type { Collection } from 'chromadb';
import type { QueryResponse } from 'chromadb/dist/main/types';
import { Document } from 'langchain/document';
import type { ChatCompletionRequestMessage } from 'openai';
import { Configuration, OpenAIApi } from 'openai';
import type { BaseChunker } from './chunkers';
import { PdfFileChunker, QnaPairChunker, WebPageChunker } from './chunkers';
import type { BaseLoader } from './loaders';
import { LocalQnaPairLoader, PdfFileLoader, WebPageLoader } from './loaders';
import type {
  DataDict,
  DataType,
  FormattedResult,
  Input,
  LocalInput,
  Metadata,
  RemoteInput,
} from './models';
import { ChromaDB } from './vectordb';
import type { BaseVectorDB } from './vectordb/BaseVectorDb';

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export type EmbedChainOptions = {
  db?: BaseVectorDB;
  storeName?: string;
  dataTypes: Record<
    string,
    {
      loader: typeof BaseLoader;
      chunker: typeof BaseChunker;
    }
  >;
};

class EmbedChain<CustomDataTypes extends string> {
  dbClient: any;

  storeName: string;

  loaders: Record<string, typeof BaseLoader> = {};

  chunkers: Record<string, typeof BaseChunker> = {};

  // TODO: Definitely assign
  collection!: Collection;

  userAsks: [CustomDataTypes, Input][] = [];

  initApp: Promise<void>;

  constructor(options?: EmbedChainOptions) {
    this.storeName = options?.storeName ?? 'embedchain_store';
    if (options?.dataTypes != null) {
      for (const i in options.dataTypes) {
        const dataType = options.dataTypes[i];
        this.addContentType(i, dataType.loader, dataType.chunker);
      }
    }
    this.loaders.pdf_file = PdfFileLoader;
    this.loaders.web_page = WebPageLoader;
    this.loaders.qna_pair = LocalQnaPairLoader;

    this.chunkers.pdf_file = PdfFileChunker;
    this.chunkers.web_page = WebPageChunker;
    this.chunkers.qna_pair = QnaPairChunker;

    const db = options?.db;
    if (!db) {
      this.initApp = this.setupChroma();
    } else {
      this.initApp = this.setupOther(db);
    }
  }

  async setupChroma(): Promise<void> {
    const db = new ChromaDB(this.storeName);
    await db.initDb;
    this.dbClient = db.client;
    if (db.collection) {
      this.collection = db.collection;
    } else {
      // TODO: Add proper error handling
      console.error('No collection');
    }
  }

  async setupOther(db: BaseVectorDB): Promise<void> {
    await db.initDb;
    // TODO: Figure out how we can initialize an unknown database.
    // this.dbClient = db.client;
    // this.collection = db.collection;
    this.userAsks = [];
  }

  setLoader<B extends typeof BaseLoader>(dataType: string, baseLoader: B) {
    this.loaders[dataType] = baseLoader;
  }

  setChunker<C extends typeof BaseChunker>(dataType: string, chunkLoader: C) {
    this.chunkers[dataType] = chunkLoader;
  }

  addContentType<B extends typeof BaseLoader, C extends typeof BaseChunker>(
    dataType: string,
    baseLoader: B,
    chunkLoader: C
  ) {
    this.setLoader(dataType, baseLoader);
    this.setChunker(dataType, chunkLoader);
  }

  getLoader(dataType: CustomDataTypes): BaseLoader {
    const Cls = this.loaders[dataType];
    if (Cls != null) {
      return new Cls();
    }
    throw new Error(`No valid loader for ${dataType}`);
  }

  getChunker(dataType: CustomDataTypes) {
    const Cls = this.chunkers[dataType];
    if (Cls != null) {
      return new Cls();
    }

    throw new Error(`No valid loader for ${dataType}`);
  }

  public async add(dataType: CustomDataTypes | {dataType: CustomDataTypes, data: Input}, url?: RemoteInput | Metadata) {
    let dType: CustomDataTypes;
    let content:Input;
    
    // Check if the datatype variable is an object
    if (typeof dataType === 'object') {
      dType = dataType.dataType;
      content = dataType.data;
    } else {
      if (url == null) {
        throw new Error("Url must be specified for remote data");
      }
      content = url;
      dType = dataType;
    }
    
    const loader = this.getLoader(dType);
    const chunker = this.getChunker(dType);
    this.userAsks.push([dType, content]);
    await this.loadAndEmbed(loader, chunker, content);
  }

  public async addLocal(dataType: CustomDataTypes, content: LocalInput) {
    const loader = this.getLoader(dataType);
    const chunker = this.getChunker(dataType);
    this.userAsks.push([dataType, content]);
    await this.loadAndEmbed(loader, chunker, content);
  }

  protected async loadAndEmbed(loader: any, chunker: BaseChunker, src: Input) {
    const embeddingsData = await chunker.createChunks(loader, src);
    let { documents, ids, metadatas } = embeddingsData;

    const existingDocs = await this.collection.get({ ids });
    const existingIds = new Set(existingDocs.ids);

    if (existingIds.size > 0) {
      const dataDict: DataDict = {};
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        if (!existingIds.has(id)) {
          dataDict.id = { doc: documents[i], meta: metadatas[i] };
        }
      }

      if (Object.keys(dataDict).length === 0) {
        console.log(`All data from ${src} already exists in the database.`);
        return;
      }
      ids = Object.keys(dataDict);
      const dataValues = Object.values(dataDict);
      documents = dataValues.map(({ doc }) => doc);
      metadatas = dataValues.map(({ meta }) => meta);
    }

    await this.collection.add({ documents, metadatas, ids });
    console.log(
      `Successfully saved ${src}. Total chunks count: ${await this.collection.count()}`
    );
  }

  static async formatResult(
    results: QueryResponse
  ): Promise<FormattedResult[]> {
    return results.documents[0].map((document: any, index: number) => {
      const metadata = results.metadatas[0][index] || {};
      // TODO: Add proper error handling
      const distance = results.distances ? results.distances[0][index] : null;
      return [new Document({ pageContent: document, metadata }), distance];
    });
  }

  static async getOpenAiAnswer(prompt: string) {
    const messages: ChatCompletionRequestMessage[] = [
      { role: 'user', content: prompt },
    ];
    const response = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages,
      temperature: 0,
      max_tokens: 1000,
      top_p: 1,
    });
    return (
      response.data.choices[0].message?.content ??
      'Response could not be processed.'
    );
  }

  protected async retrieveFromDatabase(inputQuery: string) {
    const result = await this.collection.query({
      nResults: 1,
      queryTexts: [inputQuery],
    });
    const resultFormatted = await EmbedChain.formatResult(result);
    const content = resultFormatted[0][0].pageContent;
    return content;
  }

  static generatePrompt(inputQuery: string, context: any) {
    const prompt = `Use the following pieces of context to answer the query at the end. If you don't know the answer, just say that you don't know, don't try to make up an answer.\n${context}\nQuery: ${inputQuery}\nHelpful Answer:`;
    return prompt;
  }

  static async getAnswerFromLlm(prompt: string) {
    const answer = await EmbedChain.getOpenAiAnswer(prompt);
    return answer;
  }

  public async query(inputQuery: string) {
    const context = await this.retrieveFromDatabase(inputQuery);
    const prompt = EmbedChain.generatePrompt(inputQuery, context);
    const answer = await EmbedChain.getAnswerFromLlm(prompt);
    return answer;
  }

  public async dryRun(input_query: string) {
    const context = await this.retrieveFromDatabase(input_query);
    const prompt = EmbedChain.generatePrompt(input_query, context);
    return prompt;
  }
}

class EmbedChainApp extends EmbedChain<DataType> {
  // The EmbedChain app.
  // Has two functions: add and query.
  // adds(dataType, url): adds the data from the given URL to the vector db.
  // query(query): finds answer to the given query using vector database and LLM.
}
export { EmbedChain }
export { EmbedChainApp };
