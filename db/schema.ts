import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  password: text("password").notNull(),
  avatar: text("avatar"),
  status: text("status").default("offline"),
  createdAt: timestamp("created_at").defaultNow()
});

export const channels = pgTable("channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isPrivate: boolean("is_private").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  createdById: integer("created_by_id").references(() => users.id)
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  channelId: integer("channel_id").references(() => channels.id),
  threadId: integer("thread_id"),
  attachments: jsonb("attachments"),
  reactions: jsonb("reactions"),
  createdAt: timestamp("created_at").defaultNow()
});

export const channelMembers = pgTable("channel_members", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").references(() => channels.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow()
});

// New table for tracking unread messages
export const channelUnreads = pgTable("channel_unreads", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").references(() => channels.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  lastReadMessageId: integer("last_read_message_id").references(() => messages.id),
  unreadCount: integer("unread_count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow()
});

export const directMessages = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  fromUserId: integer("from_user_id").references(() => users.id).notNull(),
  toUserId: integer("to_user_id").references(() => users.id).notNull(),
  attachments: jsonb("attachments"),
  reactions: jsonb("reactions"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow()
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
  channelMemberships: many(channelMembers),
  channelUnreads: many(channelUnreads),
  sentDirectMessages: many(directMessages, { relationName: "fromUser" }),
  receivedDirectMessages: many(directMessages, { relationName: "toUser" })
}));

export const channelsRelations = relations(channels, ({ many, one }) => ({
  messages: many(messages),
  members: many(channelMembers),
  unreads: many(channelUnreads),
  creator: one(users, {
    fields: [channels.createdById],
    references: [users.id]
  })
}));

// Handle thread relationship properly through relations
export const messagesRelations = relations(messages, ({ one, many }) => ({
  user: one(users, {
    fields: [messages.userId],
    references: [users.id]
  }),
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id]
  }),
  parentThread: one(messages, {
    fields: [messages.threadId],
    references: [messages.id]
  }),
  replies: many(messages),
  unreadTracking: many(channelUnreads, { relationName: 'lastReadMessage' })
}));

// Add relations for channel unreads
export const channelUnreadsRelations = relations(channelUnreads, ({ one }) => ({
  channel: one(channels, {
    fields: [channelUnreads.channelId],
    references: [channels.id]
  }),
  user: one(users, {
    fields: [channelUnreads.userId],
    references: [users.id]
  }),
  lastReadMessage: one(messages, {
    fields: [channelUnreads.lastReadMessageId],
    references: [messages.id]
  })
}));

// Schemas with proper validation
export const insertUserSchema = createInsertSchema(users, {
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  status: z.string().optional(),
  avatar: z.string().optional()
});

export const selectUserSchema = createSelectSchema(users);
export const insertChannelSchema = createInsertSchema(channels);
export const selectChannelSchema = createSelectSchema(channels);
export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);
export const insertChannelUnreadSchema = createInsertSchema(channelUnreads);
export const selectChannelUnreadSchema = createSelectSchema(channelUnreads);

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SelectUser = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DirectMessage = typeof directMessages.$inferSelect;
export type ChannelUnread = typeof channelUnreads.$inferSelect;