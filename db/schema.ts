import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
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
  threadId: integer("thread_id").references(() => messages.id),
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

export const directMessages = pgTable("direct_messages", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  fromUserId: integer("from_user_id").references(() => users.id).notNull(),
  toUserId: integer("to_user_id").references(() => users.id).notNull(),
  attachments: jsonb("attachments"),
  reactions: jsonb("reactions"),
  createdAt: timestamp("created_at").defaultNow()
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  messages: many(messages),
  channelMemberships: many(channelMembers),
  sentDirectMessages: many(directMessages, { relationName: "fromUser" }),
  receivedDirectMessages: many(directMessages, { relationName: "toUser" })
}));

export const channelsRelations = relations(channels, ({ many, one }) => ({
  messages: many(messages),
  members: many(channelMembers),
  creator: one(users, {
    fields: [channels.createdById],
    references: [users.id]
  })
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  user: one(users, {
    fields: [messages.userId],
    references: [users.id]
  }),
  channel: one(channels, {
    fields: [messages.channelId],
    references: [channels.id]
  }),
  thread: one(messages, {
    fields: [messages.threadId],
    references: [messages.id]
  }),
  replies: many(messages, { relationName: "thread" })
}));

// Schemas
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertChannelSchema = createInsertSchema(channels);
export const selectChannelSchema = createSelectSchema(channels);
export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

// Types
export type User = typeof users.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type DirectMessage = typeof directMessages.$inferSelect;