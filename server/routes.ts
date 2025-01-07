import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { requireAuth } from "./auth";
import { db } from "@db";
import {
  channels,
  messages,
  channelMembers,
  directMessages,
  users,
  channelUnreads,
} from "@db/schema";
import { eq, and, or, desc, asc, sql } from "drizzle-orm";
import { log } from "./vite";
import { z } from "zod";

// Channel creation validation schema
const createChannelSchema = z.object({
  name: z.string().min(1, "Channel name is required"),
  description: z.string().optional(),
  isPrivate: z.boolean().default(false),
});

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Protected API routes - must be authenticated
  app.use("/api/channels", requireAuth);
  app.use("/api/users", requireAuth);

  // Channels
  app.get("/api/channels", async (req, res) => {
    try {
      log(`[API] Fetching channels for user ${req.user!.id}`);
      const userChannels = await db
        .select({
          id: channels.id,
          name: channels.name,
          description: channels.description,
          isPrivate: channels.isPrivate,
          createdAt: channels.createdAt,
          createdById: channels.createdById,
          isMember: sql<boolean>`EXISTS (
            SELECT 1 FROM ${channelMembers}
            WHERE ${channelMembers.channelId} = ${channels.id}
            AND ${channelMembers.userId} = ${req.user!.id}
          )`,
          unreadCount: sql<number>`COALESCE(
            (SELECT unread_count FROM ${channelUnreads}
            WHERE ${channelUnreads.channelId} = ${channels.id}
            AND ${channelUnreads.userId} = ${req.user!.id}), 0
          )`,
        })
        .from(channels)
        .orderBy(asc(channels.createdAt));

      res.json(userChannels);
    } catch (error) {
      log(`[ERROR] Failed to fetch channels: ${error}`);
      res.status(500).json({ message: "Failed to fetch channels" });
    }
  });

  // Create new channel
  app.post("/api/channels", requireAuth, async (req, res) => {
    try {
      const result = createChannelSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.issues.map((i) => i.message),
        });
      }

      const { name, description, isPrivate } = result.data;

      // Start a transaction to create channel and add creator as member
      const channel = await db.transaction(async (tx) => {
        const [newChannel] = await tx
          .insert(channels)
          .values({
            name,
            description,
            isPrivate,
            createdById: req.user!.id,
          })
          .returning();

        await tx.insert(channelMembers).values({
          channelId: newChannel.id,
          userId: req.user!.id,
        });

        return newChannel;
      });

      // Notify other users about the new channel
      ws.broadcast({
        type: "channel_created",
        payload: { channel },
      });

      res.status(201).json(channel);
    } catch (error) {
      log(`[ERROR] Failed to create channel: ${error}`);
      res.status(500).json({ message: "Failed to create channel" });
    }
  });

  // Get single channel
  app.get("/api/channels/:channelId", requireAuth, async (req, res) => {
    try {
      const [channel] = await db
        .select()
        .from(channels)
        .where(eq(channels.id, parseInt(req.params.channelId)))
        .limit(1);

      if (!channel) {
        return res.status(404).json({ message: "Channel not found" });
      }
      await db
        .insert(channelMembers)
        .values({
          channelId: parseInt(req.params.channelId),
          userId: req.user!.id,
        })
        .onConflictDoNothing();
      res.json(channel);
    } catch (error) {
      log(`[ERROR] Failed to fetch channel: ${error}`);
      res.status(500).json({ message: "Failed to fetch channel" });
    }
  });

  // Mark channel messages as read
  app.post("/api/channels/:channelId/read", requireAuth, async (req, res) => {
    try {
      const channelId = parseInt(req.params.channelId);
      const userId = req.user!.id;

      // Get the latest message in the channel
      const [latestMessage] = await db
        .select()
        .from(messages)
        .where(eq(messages.channelId, channelId))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      if (!latestMessage) {
        return res.json({ message: "No messages to mark as read" });
      }

      // Update or insert the unread tracking record
      await db
        .insert(channelUnreads)
        .values({
          channelId,
          userId,
          lastReadMessageId: latestMessage.id,
          unreadCount: 0,
        })
        .onConflictDoUpdate({
          target: [channelUnreads.channelId, channelUnreads.userId],
          set: {
            lastReadMessageId: latestMessage.id,
            unreadCount: 0,
            updatedAt: new Date(),
          },
        });

      res.json({ message: "Messages marked as read" });
    } catch (error) {
      log(`[ERROR] Failed to mark messages as read: ${error}`);
      res.status(500).json({ message: "Failed to mark messages as read" });
    }
  });

  // Messages
  app.get(
    "/api/channels/:channelId/messages",
    requireAuth,
    async (req, res) => {
      try {
        const channelMessages = await db
          .select({
            message: messages,
            user: users,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(eq(messages.channelId, parseInt(req.params.channelId)))
          .orderBy(asc(messages.createdAt))
          .limit(50);

        res.json(
          channelMessages.map(({ message, user }) => ({
            ...message,
            user: {
              id: user.id,
              username: user.username,
              avatar: user.avatar,
              status: user.status,
            },
          })),
        );
      } catch (error) {
        log(`[ERROR] Failed to fetch messages: ${error}`);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    },
  );

  app.post(
    "/api/channels/:channelId/messages",
    requireAuth,
    async (req, res) => {
      try {
        const { content } = req.body;
        const channelId = parseInt(req.params.channelId);

        // Start a transaction to handle message creation and unread count updates
        const result = await db.transaction(async (tx) => {
          // Create the message
          const [message] = await tx
            .insert(messages)
            .values({
              content,
              userId: req.user!.id,
              channelId,
            })
            .returning();

          // Get the message with user information
          const [messageWithUser] = await tx
            .select({
              message: messages,
              user: users,
            })
            .from(messages)
            .innerJoin(users, eq(messages.userId, users.id))
            .where(eq(messages.id, message.id))
            .limit(1);

          // Update unread counts for all channel members except the sender
          const channelMembersList = await tx
            .select()
            .from(channelMembers)
            .where(
              and(
                eq(channelMembers.channelId, channelId),
                sql`${channelMembers.userId} != ${req.user!.id}`,
              ),
            );

          // Bulk upsert unread counts
          if (channelMembersList.length > 0) {
            await tx
              .insert(channelUnreads)
              .values(
                channelMembersList.map((member) => ({
                  channelId,
                  userId: member.userId,
                  lastReadMessageId: null,
                  unreadCount: sql`COALESCE(
                  (SELECT unread_count FROM ${channelUnreads}
                  WHERE channel_id = ${channelId}
                  AND user_id = ${member.userId}
                ), 0) + 1`,
                })),
              )
              .onConflictDoUpdate({
                target: [channelUnreads.channelId, channelUnreads.userId],
                set: {
                  unreadCount: sql`${channelUnreads.unreadCount} + 1`,
                  updatedAt: new Date(),
                },
              });
          }

          return {
            ...messageWithUser.message,
            user: {
              id: messageWithUser.user.id,
              username: messageWithUser.user.username,
              avatar: messageWithUser.user.avatar,
              status: messageWithUser.user.status,
            },
          };
        });

        // Send message through WebSocket
        ws.broadcast({
          type: "message",
          payload: {
            ...result,
            channelId,
          },
        });

        // Broadcast unread count update
        ws.broadcast({
          type: "unread_update",
          payload: {
            channelId,
            messageId: result.id,
          },
        });

        res.json(result);
      } catch (error) {
        log(`[ERROR] Failed to post message: ${error}`);
        res.status(500).json({ message: "Failed to post message" });
      }
    },
  );

  // Direct Messages
  app.get("/api/dm/:userId", requireAuth, async (req, res) => {
    try {
      const messages = await db
        .select({
          message: directMessages,
          user: users,
        })
        .from(directMessages)
        .innerJoin(users, eq(directMessages.fromUserId, users.id))
        .where(
          or(
            and(
              eq(directMessages.fromUserId, req.user!.id),
              eq(directMessages.toUserId, parseInt(req.params.userId)),
            ),
            and(
              eq(directMessages.fromUserId, parseInt(req.params.userId)),
              eq(directMessages.toUserId, req.user!.id),
            ),
          ),
        )
        .orderBy(asc(directMessages.createdAt))
        .limit(50);

      res.json(
        messages.map(({ message, user }) => ({
          ...message,
          user: {
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            status: user.status,
          },
        })),
      );
    } catch (error) {
      log(`[ERROR] Failed to fetch direct messages: ${error}`);
      res.status(500).json({ message: "Failed to fetch direct messages" });
    }
  });

  app.post("/api/dm/:userId", requireAuth, async (req, res) => {
    try {
      const { content } = req.body;
      const [message] = await db
        .insert(directMessages)
        .values({
          content,
          fromUserId: req.user!.id,
          toUserId: parseInt(req.params.userId),
        })
        .returning();

      const [messageWithUser] = await db
        .select({
          message: directMessages,
          user: users,
        })
        .from(directMessages)
        .innerJoin(users, eq(directMessages.fromUserId, users.id))
        .where(eq(directMessages.id, message.id))
        .limit(1);

      const fullMessage = {
        ...messageWithUser.message,
        user: {
          id: messageWithUser.user.id,
          username: messageWithUser.user.username,
          avatar: messageWithUser.user.avatar,
          status: messageWithUser.user.status,
        },
      };

      // Send direct message through WebSocket
      ws.broadcast({
        type: "direct_message",
        payload: fullMessage,
      });

      res.json(fullMessage);
    } catch (error) {
      log(`[ERROR] Failed to post direct message: ${error}`);
      res.status(500).json({ message: "Failed to post direct message" });
    }
  });

  // Users
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      const unreadCounts = await db
        .select({
          fromUserId: directMessages.fromUserId,
          unreadCount: sql<number>`cast(count(*) as integer)`,
        })
        .from(directMessages)
        .where(
          and(
            eq(directMessages.toUserId, req.user!.id),
            eq(directMessages.isRead, false),
          ),
        )
        .groupBy(directMessages.fromUserId);

      const usersWithUnread = allUsers.map((user) => ({
        ...user,
        unreadCount:
          unreadCounts.find((count) => count.fromUserId === user.id)
            ?.unreadCount || 0,
      }));

      res.json(usersWithUnread);
    } catch (error) {
      log(`[ERROR] Failed to fetch users: ${error}`);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // Get single user
  app.get("/api/users/:userId", requireAuth, async (req, res) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, parseInt(req.params.userId)))
        .limit(1);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      log(`[ERROR] Failed to fetch user: ${error}`);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  return httpServer;
}
