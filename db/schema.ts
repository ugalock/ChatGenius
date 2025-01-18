import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  PgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Add type definition for file attachments
export const attachmentSchema = z.object({
  fileName: z.string(),
  fileSize: z.number(),
  fileType: z.string(),
  url: z.string(),
  uploadedAt: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  avatar: text("avatar"),
  bio: text("bio"),
  status: text("status").default("offline"),
  createdAt: timestamp("created_at").defaultNow(),
  aiUpdatedAt: timestamp("ai_updated_at").defaultNow(),
  useAiResponse: boolean("use_ai_response").default(false),
});

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isPrivate: boolean("is_private").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  createdById: integer("created_by_id").references(() => users.id),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  channelId: integer("channel_id").references(() => channels.id),
  threadId: integer("thread_id").references(() : PgColumn => messages.id),
  attachments: jsonb("attachments").$type<Attachment[]>(),
  reactions: jsonb("reactions").$type<Record<string, number[]>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const channelMembers = pgTable(
  "channel_members",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id")
      .references(() => channels.id)
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    channelMembersUnique: unique().on(table.channelId, table.userId),
  }),
);

export const channelUnreads = pgTable(
  "channel_unreads",
  {
    cu_id: serial("cu_id").primaryKey(),
    channelId: integer("channel_id")
      .references(() => channels.id)
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    lastReadMessageId: integer("last_read_message_id").references(
      () => messages.id,
    ),
    unreadCount: integer("unread_count"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    channelUserUnique: unique().on(table.channelId, table.userId),
  }),
);

export const directMessages = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  fromUserId: integer("from_user_id")
    .references(() => users.id)
    .notNull(),
  toUserId: integer("to_user_id")
    .references(() => users.id)
    .notNull(),
  threadId: integer("thread_id").references(() : PgColumn => directMessages.id),
  attachments: jsonb("attachments").$type<Attachment[]>(),
  reactions: jsonb("reactions").$type<Record<string, number[]>>().default({}),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messageReads = pgTable(
  "message_reads",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .references(() => messages.id)
      .notNull(),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    readAt: timestamp("read_at").defaultNow(),
  },
  (table) => ({
    messageUserUnique: unique().on(table.messageId, table.userId),
  }),
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
  channelMemberships: many(channelMembers),
  channelUnreads: many(channelUnreads),
  sentDirectMessages: many(directMessages, { relationName: "fromUser" }),
  receivedDirectMessages: many(directMessages, { relationName: "toUser" }),
}));

export const channelsRelations = relations(channels, ({ many, one }) => ({
  messages: many(messages),
  members: many(channelMembers),
  unreads: many(channelUnreads),
  creator: one(users, {
    fields: [channels.createdById],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  user: one(users, {
    fields: [messages.userId],
    references: [users.id],
  }),
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id],
  }),
  parentThread: one(messages, {
    fields: [messages.threadId],
    references: [messages.id],
  }),
  replies: many(messages, {
    relationName: "threadReplies",
  }),
  reads: many(messageReads),
  unreadTracking: many(channelUnreads, { relationName: "lastReadMessage" }),
}));

export const directMessagesRelations = relations(directMessages, ({ one, many }) => ({
  fromUser: one(users, {
    fields: [directMessages.fromUserId],
    references: [users.id],
  }),
  toUser: one(users, {
    fields: [directMessages.toUserId],
    references: [users.id],
  }),
  parentThread: one(directMessages, {
    fields: [directMessages.threadId],
    references: [directMessages.id],
  }),
  replies: many(directMessages, {
    relationName: "dmThreadReplies",
  }),
}));

export const channelUnreadsRelations = relations(channelUnreads, ({ one }) => ({
  channel: one(channels, {
    fields: [channelUnreads.channelId],
    references: [channels.id],
  }),
  user: one(users, {
    fields: [channelUnreads.userId],
    references: [users.id],
  }),
  lastReadMessage: one(messages, {
    fields: [channelUnreads.lastReadMessageId],
    references: [messages.id],
  }),
}));

export const messageReadsRelations = relations(messageReads, ({ one }) => ({
  message: one(messages, {
    fields: [messageReads.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageReads.userId],
    references: [users.id],
  }),
}));

// Explicitly define the reaction schema for better type safety
export const reactionSchema = z.record(z.string(), z.array(z.number()));

// Update message schemas
export const insertMessageSchema = createInsertSchema(messages).extend({
  reactions: reactionSchema.optional().default({}),
  attachments: z.array(attachmentSchema).optional(),
});

export const selectMessageSchema = createSelectSchema(messages).extend({
  reactions: reactionSchema,
  attachments: z.array(attachmentSchema).optional(),
});

// Same for direct messages
export const insertDirectMessageSchema = createInsertSchema(directMessages).extend({
  reactions: reactionSchema.optional().default({}),
  attachments: z.array(attachmentSchema).optional(),
});

export const selectDirectMessageSchema = createSelectSchema(directMessages).extend({
  reactions: reactionSchema,
  attachments: z.array(attachmentSchema).optional(),
});

// Export types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DirectMessage = typeof directMessages.$inferSelect;
export type ChannelUnread = typeof channelUnreads.$inferSelect;
export type MessageRead = typeof messageReads.$inferSelect;