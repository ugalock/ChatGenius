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
  messageReads,
} from "@db/schema";
import { eq, and, or, desc, asc, sql, lt, gt } from "drizzle-orm";
import { log } from "./vite";
import { z } from "zod";

// Channel creation validation schema
const createChannelSchema = z.object({
  name: z.string().min(1, "Channel name is required"),
  description: z.string().optional(),
  isPrivate: z.boolean().default(false),
});

// Message query param validation schema
const messageQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.string().default("50"),
});

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Protected API routes - must be authenticated
  app.use("/api/channels", requireAuth);
  app.use("/api/users", requireAuth);

  // Channels
  app.get("/api/channels/all", requireAuth, async (req, res) => {
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
            SELECT 1 FROM ${channelMembers} cm
            WHERE cm.channel_id = ${channels.id}
            AND cm.user_id = ${req.user!.id}
          )`,
          unreadCount: sql<number>`
            COALESCE(
              (
                SELECT COUNT(msg.id)::integer 
                FROM ${messages} msg
                WHERE msg.channel_id = channels.id
                AND NOT EXISTS (
                  SELECT 1 FROM ${messageReads} mr
                  WHERE mr.message_id = msg.id
                  AND mr.user_id = ${req.user!.id}
                )
              ),
              0
            )
          `,
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

  // Update last read message
  app.post("/api/channels/:channelId/read", requireAuth, async (req, res) => {
    try {
      const { messageId } = req.body;
      const channelId = parseInt(req.params.channelId);
      const userId = req.user!.id;

      // Verify the message exists and belongs to the channel
      const [message] = await db
        .select()
        .from(messages)
        .where(
          and(eq(messages.id, messageId), eq(messages.channelId, channelId)),
        )
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Update or insert the unread tracking record
      await db
        .insert(channelUnreads)
        .values({
          channelId,
          userId,
          lastReadMessageId: messageId,
        })
        .onConflictDoUpdate({
          target: [channelUnreads.channelId, channelUnreads.userId],
          set: {
            lastReadMessageId: messageId,
            updatedAt: new Date(),
          },
        });

      // Broadcast unread update
      ws.broadcast({
        type: "unread_update",
        payload: {
          channelId,
          messageId,
          userId,
        },
      });

      res.json({ message: "Last read message updated" });
    } catch (error) {
      log(`[ERROR] Failed to update last read message: ${error}`);
      res.status(500).json({ message: "Failed to update last read message" });
    }
  });

  // Messages with pagination
  app.get(
    "/api/channels/:channelId/messages",
    requireAuth,
    async (req, res) => {
      try {
        const queryResult = messageQuerySchema.safeParse(req.query);
        if (!queryResult.success) {
          return res.status(400).json({
            message: "Invalid query parameters",
            errors: queryResult.error.issues,
          });
        }

        const { before, after, limit } = queryResult.data;
        const channelId = parseInt(req.params.channelId);
        const messageLimit = Math.min(parseInt(limit), 50);

        // Base query with proper types
        let query = db
          .select({
            id: messages.id,
            content: messages.content,
            channelId: messages.channelId,
            userId: messages.userId,
            createdAt: messages.createdAt,
            updatedAt: messages.updatedAt,
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
              status: users.status,
            },
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(eq(messages.channelId, channelId));

        // Add pagination conditions
        if (before) {
          query = query.where(lt(messages.id, parseInt(before)));
        } else if (after) {
          query = query.where(gt(messages.id, parseInt(after)));
        }

        // Execute query with ordering and limit
        const channelMessages = await query
          .orderBy(after ? asc(messages.createdAt) : desc(messages.createdAt))
          .limit(messageLimit);

        // Format response
        const response = {
          data: channelMessages,
          nextCursor:
            channelMessages.length === messageLimit
              ? after
                ? channelMessages[channelMessages.length - 1].id.toString()
                : channelMessages[0].id.toString()
              : null,
          prevCursor:
            channelMessages.length === messageLimit
              ? after
                ? null
                : channelMessages[channelMessages.length - 1].id.toString()
              : null,
        };

        res.json(response);
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

        const result = await db.transaction(async (tx) => {
          const [message] = await tx
            .insert(messages)
            .values({
              content,
              userId: req.user!.id,
              channelId,
            })
            .returning();

          const [messageWithUser] = await tx
            .select({
              message: messages,
              user: users,
            })
            .from(messages)
            .innerJoin(users, eq(messages.userId, users.id))
            .where(eq(messages.id, message.id))
            .limit(1);

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

        // Broadcast unread update
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

  app.delete("/api/channel-members/:id", requireAuth, async (req, res) => {
    try {
      await db
        .delete(channelMembers)
        .where(eq(channelMembers.id, parseInt(req.params.id)))
        .execute();

      res.json({ message: "Channel member deleted successfully" });
    } catch (error) {
      log(`[ERROR] Failed to delete channel member: ${error}`);
      res.status(500).json({ message: "Failed to delete channel member" });
    }
  });

  // Mark individual message as read
  app.post("/api/messages/:messageId/read", requireAuth, async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const userId = req.user!.id;

      // Verify the message exists
      const [message] = await db
        .select()
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Insert or ignore (if already exists) the message read record
      await db
        .insert(messageReads)
        .values({
          messageId,
          userId,
        })
        .onConflictDoNothing();

      // Broadcast read status update
      ws.broadcast({
        type: "message_read",
        payload: {
          messageId,
          userId,
          channelId: message.channelId ?? undefined,
        },
      });

      res.json({ message: "Message marked as read" });
    } catch (error) {
      log(`[ERROR] Failed to mark message as read: ${error}`);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  return httpServer;
}