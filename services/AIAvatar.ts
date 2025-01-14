import { Index, Pinecone as PineconeClient } from "@pinecone-database/pinecone";
import { Document } from "langchain/document";
import { PineconeStore } from "@langchain/pinecone";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { BaseMessage } from "@langchain/core/messages";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { createHistoryAwareRetriever } from "langchain/chains/history_aware_retriever";
import { createRetrievalChain } from "langchain/chains/retrieval";

// Types for our domain
interface Message {
  id: number;
  userId?: number;
  fromUserId?: number;
  toUserId?: number;
  content: string;
  createdAt: Date;
  channelId?: number;
}

interface AvatarConfig {
  userId: number;
  personalityTraits: string[];
  responseStyle: string;
  writingStyle: string;
  contextWindow: number;
}

export class AIAvatarService {
  private pineconeClient: PineconeClient;
  private embeddings: OpenAIEmbeddings;
  private llm: ChatOpenAI;
  private indexName = "3072-chatgenius";
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
      temperature: 0.7,
      modelName: "gpt-4o-mini",
    });
    this.index = this.pineconeClient.Index(this.indexName);
    this.vectorStore = null;
  }

  async initialize() {
    this.vectorStore = await PineconeStore.fromExistingIndex(this.embeddings, {
      pineconeIndex: this.index,
    });
  }

  async indexUserMessage(message: Message): Promise<void> {
    // Create a document from the message
    const isMsg = "channelId" in message;
    const doc = new Document({
      id: `${isMsg ? "msg" : "dm"}_${message.id}`,
      pageContent: `[User ${isMsg ? message.userId : message.fromUserId}] ${message.content}`,
      metadata: {
        userId: isMsg ? message.userId?.toString() : message.fromUserId?.toString(),
        timestamp: Math.floor(message.createdAt.getTime() / 1000),
        channelId: isMsg ? message.channelId?.toString() : message.fromUserId! > message.toUserId! ? `dm_${message.toUserId}_${message.fromUserId}` : `dm_${message.fromUserId}_${message.toUserId}`,
      },
    });

    await this.vectorStore!.addDocuments([doc], [`${isMsg ? "msg" : "dm"}_${message.id}`]);
  }

  async indexUserMessages(messages: Message[]): Promise<void> {
    const documents = [];
    const ids = [];
    // Create documents from the messages
    for (const message of messages) {
      const isMsg = "channelId" in message;
      const msgId = `${isMsg ? "msg" : "dm"}_${message.id}`;
      ids.push(msgId);
      const doc = new Document({
        id: msgId,
        pageContent: `[User ${isMsg ? message.userId : message.fromUserId}] ${message.content}`,
        metadata: {
          userId: isMsg ? message.userId?.toString() : message.fromUserId?.toString(),
          timestamp: Math.floor(message.createdAt.getTime() / 1000),
          channelId: isMsg ? message.channelId?.toString() : message.fromUserId! > message.toUserId! ? `dm_${message.toUserId}_${message.fromUserId}` : `dm_${message.fromUserId}_${message.toUserId}`,
        },
      });
      documents.push(doc);
    }

    await this.vectorStore!.addDocuments(documents, ids);
  }

  async createAvatarPersona(userId: number): Promise<AvatarConfig> {
    const userMessages = await this.vectorStore!.similaritySearch("", 100, { userId: {'$eq': userId.toString()} });

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
    return {userId: userId, contextWindow: 100, personalityTraits: content.personalityTraits, responseStyle: content.responseStyle, writingStyle: content.writingStyle};
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

  async generateAvatarResponse(
    userId: number,
    message: Message,
  ): Promise<string> {
    const fromUserId = "userId" in message ? message.userId : message.fromUserId;
    const channelId = "userId" in message ? message.channelId?.toString() : message.fromUserId! > message.toUserId! ? `dm_${message.toUserId}_${message.fromUserId}` : `dm_${message.fromUserId}_${message.toUserId}`;
    // Get avatar configuration
    var configQuery = await this.vectorStore!.similaritySearch(
      `avatar-config-${userId}`,
      1,
      { type: "avatar-config", userId: {'$eq': userId!.toString()} },
    );
    // console.log(configQuery);
    if (configQuery.length === 0) {
      const persona = await this.createAvatarPersona(userId);
      await this.configureAvatar(persona);
      configQuery = await this.vectorStore!.similaritySearch(
        `avatar-config-${userId}`,
        1,
        { type: "avatar-config", userId: {'$eq': userId!.toString()} },
      );
    }
    const avatarConfig: AvatarConfig = JSON.parse(configQuery[0].metadata.config);

    const llm = this.llm;
    // const retriever = this.vectorStore!.asRetriever({
    //     filter: { timestamp: {'$gt': Math.floor(message.createdAt.getTime() / 1000) - (3600 * 48)}, channelId: {'$eq': channelId} },
    //     k: avatarConfig.contextWindow,
    //   });
    const retriever = this.vectorStore!.asRetriever({
      filter: { timestamp: {'$gt': Math.floor(message.createdAt.getTime() / 1000) - (3600 * 48)}, channelId: {'$eq': channelId} },
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
