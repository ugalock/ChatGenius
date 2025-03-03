import * as path from 'path';
import * as fs from 'fs';
import { Index, Pinecone as PineconeClient, ScoredPineconeRecord, RecordMetadata } from "@pinecone-database/pinecone";
import { Document } from "langchain/document";
import { PineconeStore } from "@langchain/pinecone";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { type MaxMarginalRelevanceSearchOptions } from "@langchain/core/vectorstores";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { maximalMarginalRelevance } from "@langchain/core/utils/math";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { 
  type Attachment, 
  type Message as dbMessage, 
  type DirectMessage,
} from "@db/schema";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { OpenAIWhisperAudio } from "@langchain/community/document_loaders/fs/openai_whisper_audio";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

// Types for our domain
type Message = dbMessage | DirectMessage;

type PineconeMetadata = Record<string, any>;

interface AvatarConfig {
  userId: number;
  personalityTraits: string[];
  responseStyle: string;
  writingStyle: string;
  contextWindow: number;
}

interface SearchResult {
  msg_ids: number[];
  dm_ids: number[];
}

interface SearchFilter {
  fromUserId?: number;
  toUserId?: number;
  channelId?: string;
  fileTypes?: string[];
}

// Helper functions for processing attachments
async function processTextBasedFile(filePath: string, fileType: string): Promise<string> {
  let text = "";
  if (fileType === "application/pdf") {
    const loader = new PDFLoader(filePath, { parsedItemSeparator: " " });
    const docs = await loader.load();
    text = docs.map((doc: Document) => doc.pageContent).join("\n");
  } else if (fileType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const loader = new DocxLoader(filePath);
    const docs = await loader.load();
    text = docs.map((doc: Document) => doc.pageContent).join("\n");
  } else {
    // For plain text, code files, etc.
    const loader = new TextLoader(filePath);
    const docs = await loader.load();
    text = docs.map((doc: Document) => doc.pageContent).join("\n");
  }
  return text;
}

async function processImageFile(filePath: string): Promise<string> {
  const imageData = await fs.promises.readFile(filePath);
  const base64Image = imageData.toString('base64');

  const message = new HumanMessage({
    content: [
      { type: "text", text: "Please describe the image in detail." },
      {
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${base64Image}` },
      },
    ]
  });
  const llm = new ChatOpenAI({
    temperature: 0.3,
    modelName: "chatgpt-4o-latest",
  });

  const imageDescriptionAiMsg = await llm.invoke([message]);
  console.log(imageDescriptionAiMsg.content);
  return imageDescriptionAiMsg.content as string;
}

async function processAudioVideo(filePath: string): Promise<string> {
  const loader = new OpenAIWhisperAudio(filePath);
  const docs = await loader.load();
  return docs.map((doc: Document) => doc.pageContent).join("\n") || "Audio/video content could not be transcribed";
}

async function processAttachment(attachment: Attachment): Promise<{ content: string, type: string }> {
  const filePath = path.join(process.cwd(), attachment.url);
  let content = "", type = "";
  try {
    if (attachment.fileType.startsWith("image/")) {
      content = await processImageFile(filePath);
      type = "image";
    } else if (attachment.fileType.startsWith("audio/") || attachment.fileType.startsWith("video/")) {
      content = await processAudioVideo(filePath);
      type = attachment.fileType.startsWith("audio/") ? "audio" : "video";
    } else {
      content = await processTextBasedFile(filePath, attachment.fileType);
      type = "text";
    }
    return { content, type };
  } catch (error) {
    console.error(`Error processing attachment ${attachment.fileName}:`, error);
    return { content: `[Attachment: ${attachment.fileName}]`, type: "text" };
  }
}

export class AIAvatarService {
  private pineconeClient: PineconeClient;
  private embeddings: OpenAIEmbeddings;
  private llm: ChatOpenAI;
  private indexName = "3072-chatgenius";
  private contextWindow = 25;
  private chunkSize = 600;
  private chunkOverlap = 100;
  private index: Index;
  private vectorStore: PineconeStore | null;

  constructor() {
    this.pineconeClient = new PineconeClient({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    this.embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-large",
      dimensions: 3072,
    });
    this.llm = new ChatOpenAI({
      temperature: 0.3,
      modelName: "chatgpt-4o-latest",
    });
    this.index = this.pineconeClient.Index(this.indexName);
    this.vectorStore = null;
  }

  async initialize() {
    this.vectorStore = await PineconeStore.fromExistingIndex(this.embeddings, {
      pineconeIndex: this.index,
    });
  }

  private _formatMatches(
    matches: ScoredPineconeRecord<RecordMetadata>[] = []
  ): [Document, number][] {
    const documentsWithScores: [Document, number][] = [];

    for (const record of matches) {
      const {
        id,
        score,
        metadata: { [this.vectorStore!.textKey]: pageContent, ...metadata } = {
          [this.vectorStore!.textKey]: "",
        },
      } = record;

      if (score) {
        documentsWithScores.push([
          new Document({
            id,
            pageContent: pageContent?.toString() ?? "",
            metadata,
          }),
          score,
        ]);
      }
    }

    return documentsWithScores;
  }

  protected async _runPineconeQuery(
    query: number[],
    k: number,
    filter?: PineconeMetadata,
    options?: { includeValues: boolean }
  ) {
    if (filter && this.vectorStore!.filter) {
      throw new Error("cannot provide both `filter` and `this.vectorStore!.filter`");
    }
    const _filter = filter ?? this.vectorStore!.filter;

    let optionsNamespace = this.vectorStore!.namespace ?? "";
    if (_filter && "namespace" in _filter) {
      optionsNamespace = _filter.namespace;
      delete _filter.namespace;
    }

    const namespace = this.vectorStore!.pineconeIndex.namespace(optionsNamespace ?? "");
    console.log(_filter);
    const results = await namespace.query({
      includeMetadata: true,
      topK: k,
      vector: query,
      filter: _filter,
      ...options,
    });
    return results;
  }

  async indexUserMessage(message: Message): Promise<void> {
    // Create a document from the message
    const isMsg = "channelId" in message;
    const messageId = `${isMsg ? "msg" : "dm"}_${message.id}`;
    const userId = isMsg ? message.userId : message.fromUserId;
    const channelId = isMsg ? message.channelId?.toString() : 
      message.fromUserId! > message.toUserId! ? 
        `dm_${message.toUserId}_${message.fromUserId}` : 
        `dm_${message.fromUserId}_${message.toUserId}`;

    // Process message content
    let documents: Document[] = [];
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    const pageContent = `[User ${userId}] ${message.content}`;
    if (pageContent.length > this.chunkSize) {
      const chunks = await textSplitter.createDocuments([pageContent], [{
        userId: userId?.toString(),
        timestamp: Math.floor(message.createdAt!.getTime() / 1000),
        channelId: channelId,
        type: 'message'
      }]);
      documents.push(...chunks);
    } else {
      // Add main message content
      documents.push(new Document({
        id: messageId,
        pageContent: pageContent,
        metadata: {
          userId: userId?.toString(),
          timestamp: Math.floor(message.createdAt!.getTime() / 1000),
          channelId: channelId,
          type: 'message'
        },
      }));
    }

    // Process attachments if any
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        try {
          const { content, type } = await processAttachment(attachment);
          const chunks = await textSplitter.createDocuments([content], [{
            userId: userId?.toString(),
            timestamp: Math.floor(message.createdAt!.getTime() / 1000),
            channelId: channelId,
            messageId: messageId,
            type: 'attachment',
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileFormat: type
          }]);
          documents.push(...chunks);
        } catch (error) {
          console.error(`Failed to process attachment ${attachment.fileName}:`, error);
          // throw error;
        }
      }
    }

    // Add all documents to the vector store
    const ids = documents.map((doc, index) => 
      doc.metadata.type === 'message' ? messageId : `${messageId}_attachment_${index}`
    );
    await this.vectorStore!.addDocuments(documents, ids);
  }

  async mmrSearch(query: string, options: MaxMarginalRelevanceSearchOptions<PineconeMetadata>): Promise<[Document, number][]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);

    const results = await this._runPineconeQuery(
      queryEmbedding,
      options.fetchK ?? 20,
      options.filter,
      { includeValues: true }
    );

    const { matches = [] } = results;
    const embeddingList = matches.map((match) => match.values);

    const mmrIndexes = maximalMarginalRelevance(
      queryEmbedding,
      embeddingList,
      options.lambda,
      options.k
    );

    const topMmrMatches = mmrIndexes.map((idx) => matches[idx]);
    return this._formatMatches(topMmrMatches);
  }

  async search(query: string, searchFilter: SearchFilter): Promise<SearchResult> {
    const msg_ids : number[] = [], dm_ids : number[] = [];
    const filter : PineconeMetadata = {};
    if (searchFilter.fromUserId && searchFilter.toUserId) {
      const key = searchFilter.fromUserId > searchFilter.toUserId ? `dm_${searchFilter.toUserId}_${searchFilter.fromUserId}` : `dm_${searchFilter.fromUserId}_${searchFilter.toUserId}`;
      filter.channelId = { '$eq': key };
    } else if (searchFilter.channelId) {
      filter.channelId = { '$eq': `${searchFilter.channelId}` };
    }
    let k = searchFilter.fileTypes ? 150 : 100;
    if (searchFilter.fileTypes) {
      if (searchFilter.fileTypes.includes("message")) {
        if (searchFilter.fileTypes.length === 1) {
          filter.type = { '$eq': 'message' };
          k = 100;
        } else {
          filter.type = { '$or': [{ '$eq': 'message' }, { '$eq': 'attachment' }] };
        }
      } else {
        filter.type = { '$eq': 'attachment' };
      }
      const fileTypes = searchFilter.fileTypes.filter((fileType) => fileType !== "message");
      if (fileTypes) {
        if (fileTypes.length === 1) {
          if (searchFilter.fileTypes.includes("message")) {
            filter['$or'] = [{ type: { '$eq': 'message' } }, { fileFormat: { '$eq': fileTypes[0] } }];
          } else {
            filter.fileFormat = { '$eq': fileTypes[0] };
          }
        } else {
          filter['$or'] = fileTypes.map((fileType) => ({ fileFormat: { '$eq': fileType } }));
          if (searchFilter.fileTypes.includes("message")) {
            filter['$or'].push({ type: { '$eq': 'message' } });
          }
        }
      }
    }
    const results = await this.mmrSearch(query, { k: k, filter, fetchK: k, lambda: 0.75 });
    // console.log(results);
    // console.log(results.length);
    const scoreLookup = new Map<string, number>();
    for (const [result, score] of results) {
      if (result.id!.startsWith("msg_") || result.id!.startsWith("dm_")) {
        const parts = result.id!.split("_");
        const key = `${parts[0]}_${parts[1]}`;
        scoreLookup.set(key, Math.max(scoreLookup.get(key) || 0, score));
      }
    }
    // console.log(scoreLookup);
    // console.log(scoreLookup.size);
    const sortedIds = Array.from(scoreLookup.entries()).sort((a, b) => b[1] - a[1]).map(([id, _]) => id);
    console.log("sortedIds.length", sortedIds.length);
    for (const id of sortedIds.slice(0, 25)) {
      if (id.startsWith("msg_")) {
        msg_ids.push(parseInt(id.split("_")[1]));
      } else if (id.startsWith("dm_")) {
        dm_ids.push(parseInt(id.split("_")[1]));
      }
    }
    return { msg_ids, dm_ids };
  }

  async deleteUserMessage(message: Message): Promise<void> {
    const isMsg = "channelId" in message;
    const messageId = `${isMsg ? "msg" : "dm"}_${message.id}`;
    await this.vectorStore!.delete({ ids: [messageId] });
    // await this.vectorStore!.delete({ filter: { messageId: {'$eq': messageId} } });
    for (let i = 1; i < 50; i++) {
      const vectors = await this.vectorStore!.similaritySearch(
        "",
        1000,
        { type: "attachment", messageId: { '$eq': messageId } },
      );
      if (vectors.length === 0) {
        break;
      }
      await this.vectorStore!.delete({ ids: vectors.map((v) => v.id!) });
    }
  }

  async deleteAllAttachments(): Promise<void> {
    for (let i = 1; i < 50; i++) {
      const vectors = await this.vectorStore!.similaritySearch(
        "",
        1000,
        { type: "attachment" },
      );
      if (vectors.length === 0) {
        break;
      }
      console.log(vectors.length);
      await this.vectorStore!.delete({ ids: vectors.map((v) => v.id!) });
    }
  }

  async getTextSummary(text: string): Promise<string> {
    const prompt = `
      Summarize the following text in 5 sentences or less:
      ${text}
    `;
    const llm = new ChatOpenAI({
      temperature: 0.7,
      modelName: "gpt-4o",
    });
    const response = await llm.invoke(prompt);
    return response.content as string;
  }

  async attachmentSummary(message: Message, attachment: Attachment): Promise<string> {
    const filePath = path.join(process.cwd(), attachment.url);
    const isMsg = "channelId" in message;
    const messageId = `${isMsg ? "msg" : "dm"}_${message.id}`;
    let content = "";
    if (attachment.fileType.startsWith("image/")) {
      const [vector] = await this.vectorStore!.similaritySearch(
        "",
        1,
        { type: "attachment", fileFormat: {'$eq': "image"}, messageId: {'$eq': messageId} },
      );
      if (vector) {
        return vector.pageContent;
      }
      content = await processImageFile(filePath);
    } else if (attachment.fileType.startsWith("audio/") || attachment.fileType.startsWith("video/")) {
      content = await processAudioVideo(filePath);
    } else {
      content = await processTextBasedFile(filePath, attachment.fileType);
    }
    return await this.getTextSummary(content);
  }

  async createAvatarPersona(userId: number): Promise<AvatarConfig> {
    const userMessages = await this.vectorStore!.similaritySearch("", 100, { userId: {'$eq': userId.toString()} });

    // Generate default config if message sample size is too small
    if (userMessages.length < 25) {
      const content = {"personalityTraits": ["intellectually curious and engaged","adaptable to context and tone","thoughtful and systematic in problem-solving","empathetic and sensitive to human concerns","honest about capabilities and limitations","precise without being pedantic","willing to explore hypotheticals while maintaining authenticity","focused on being helpful while maintaining ethical boundaries"],"responseStyle": "Engages naturally and authentically, varying approach based on context. For technical topics, is precise and systematic, breaking down complex problems step-by-step. For creative or open-ended discussions, is more explorative and conversational. Asks focused follow-up questions when needed but avoid overwhelming with multiple questions. Acknowledges uncertainties directly rather than hedging. When faced with ambiguous requests, seeks clarification while offering plausible interpretations.","writingStyle": "Writing is clear and adaptable, using markdown for structure when appropriate. Employs proper punctuation and grammar while maintaining conversational flow. Varies sentence structure and vocabulary naturally, avoiding repetitive phrases or rote responses. Uses paragraphs for explanations rather than defaulting to lists. For technical content, includes code blocks with appropriate syntax highlighting. Maintains consistent formatting throughout responses, including proper spacing after headers and list items. Prefers active voice and concrete examples over abstract explanations."};
      return { userId: userId, contextWindow: this.contextWindow, personalityTraits: content.personalityTraits, responseStyle: content.responseStyle, writingStyle: content.writingStyle };
    } else {
      // Analyze messages to create persona
      const prompt = `
        Analyze these messages and create a detailed persona description:
        ${userMessages.map((msg) => msg.pageContent).join("\n")}
  
        Focus on:
        1. Communication style
        2. Typical responses
        3. Common phrases
        4. Tone and sentiment
        5. Knowledge areas
        6. Writing style
  
        The goal of this persona creation is to help the AI generate a unique and personalized response in the voice of the user. Writing style should include grammar, punctuation, and style.
  
        Output should be a JSON object with the following format:
        {
          "personalityTraits": ["personalityTrait1", "personalityTrait2", ...],
          "responseStyle": "responseStyle",
          "writingStyle": "writingStyle",
        }
      `;
  
      const jsonLlm = this.llm.bind({ response_format: { type: "json_object" } });
      const response = await jsonLlm.invoke(prompt);
      const content = typeof response.content === "string" ? JSON.parse(response.content) : response.content;
      console.log(content);
      return { userId: userId, contextWindow: this.contextWindow, personalityTraits: content.personalityTraits, responseStyle: content.responseStyle, writingStyle: content.writingStyle };
    }
  }

  async configureAvatar(config: AvatarConfig): Promise<void> {
    const jsonConfig = JSON.stringify(config);
    // Store avatar configuration in a separate collection
    await this.index.upsert([
      {
        id: `avatar-config-${config.userId}`,
        values: await this.embeddings.embedQuery(jsonConfig),
        metadata: {
          type: "avatar-config",
          userId: config.userId.toString(),
          config: jsonConfig,
        },
      },
    ]);
  }

  async getAvatarConfig(userId: number): Promise<AvatarConfig> {
    // Get avatar configuration
    let configQuery = await this.vectorStore!.similaritySearch(
      `avatar-config-${userId}`,
      1,
      { type: "avatar-config", userId: {'$eq': userId!.toString()} },
    );
    
    // Generate config if necessary
    if (configQuery.length === 0) {
      const persona = await this.createAvatarPersona(userId);
      await this.configureAvatar(persona);
      configQuery = await this.vectorStore!.similaritySearch(
        `avatar-config-${userId}`,
        1,
        { type: "avatar-config", userId: {'$eq': userId!.toString()} },
      );
    }
    return JSON.parse(configQuery[0].metadata.config);
  }

  async updateAvatarConfig(userId: number, personalityTraits: string[], responseStyle: string, writingStyle: string): Promise<void> {
    const config = { userId: userId, contextWindow: this.contextWindow, personalityTraits: personalityTraits, responseStyle: responseStyle, writingStyle: writingStyle };
    await this.configureAvatar(config);
  }

  async generateAvatarResponse(
    userId: number,
    message: Message,
  ): Promise<string> {
    const fromUserId = "userId" in message ? message.userId : message.fromUserId;
    const channelId = "userId" in message ? message.channelId?.toString() : message.fromUserId! > message.toUserId! ? `dm_${message.toUserId}_${message.fromUserId}` : `dm_${message.fromUserId}_${message.toUserId}`;
    
    const avatarConfig: AvatarConfig = await this.getAvatarConfig(userId);

    const llm = this.llm;
    // const retriever = this.vectorStore!.asRetriever({
    //     filter: { timestamp: {'$gt': Math.floor(message.createdAt.getTime() / 1000) - (3600 * 48)}, channelId: {'$eq': channelId} },
    //     k: avatarConfig.contextWindow,
    //   });
    const retriever = this.vectorStore!.asRetriever({
      filter: { timestamp: {'$gt': Math.floor(message.createdAt!.getTime() / 1000) - (3600 * 24 * 5)}, channelId: {'$eq': channelId} },
      k: avatarConfig.contextWindow,
    });
    // Contextualize question
    const contextualizeQSystemPrompt = `
    Given a chat history and the latest user question
    which might reference context in the chat history,
    formulate a standalone question which can be understood
    without the chat history. Do NOT answer the question, just
    reformulate it if needed and otherwise return it as is.`;
    const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
      ["system", contextualizeQSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["human", "{input}"],
    ]);
    const historyAwareRetriever = await createHistoryAwareRetriever({
      llm,
      retriever,
      rephrasePrompt: contextualizeQPrompt,
    });

    // Answer question
    const qaSystemPrompt = `
        You are acting as [User ${userId}]'s AI avatar.
        Personality traits: ${avatarConfig.personalityTraits.join(", ")}
        Response style: ${avatarConfig.responseStyle}
        Writing style: ${avatarConfig.writingStyle}

        Generate a response that matches their communication style, personality, and personal writing style.'
    \n\n
    {context}`;
    const qaPrompt = ChatPromptTemplate.fromMessages([
      ["system", qaSystemPrompt],
      new MessagesPlaceholder("chat_history"),
      ["human", "{input}"],
    ]);

    // Below we use createStuffDocuments_chain to feed all retrieved context
    // into the LLM. Note that we can also use StuffDocumentsChain and other
    // instances of BaseCombineDocumentsChain.
    const questionAnswerChain = await createStuffDocumentsChain({
      llm,
      prompt: qaPrompt,
    });

    const ragChain = await createRetrievalChain({
      retriever: historyAwareRetriever,
      combineDocsChain: questionAnswerChain,
    });

    const chat_history: BaseMessage[] = [];
    const response = await ragChain.invoke({
      chat_history,
      input: message.content,
    });
    // console.log(response);
    return response.answer;
  }
}

// Example usage
// async function setupAvatarSystem() {
//   const avatarService = new AIAvatarService();
//   await avatarService.initialize();

//   // Index a new message
//   await avatarService.indexUserMessage({
//     id: 1,
//     userId: 1,
//     content: "Hey team, let's sync up tomorrow to discuss the project roadmap!",
//     createdAt: new Date(),
//   });

//   // Create and configure avatar
//   const persona = await avatarService.createAvatarPersona(1);
//   // await avatarService.configureAvatar({
//   //   userId: 1,
//   //   personalityTraits: ['professional', 'collaborative', 'proactive'],
//   //   responseStyle: 'friendly but business-focused',
//   //   contextWindow: 10
//   // });
//   await avatarService.configureAvatar(persona);

//   // Generate avatar response
//   const response = await avatarService.generateAvatarResponse(
//     1,
//     "Do you have any updates on the project roadmap?",
//   );

//   console.log("Avatar Response:", response);
// }
