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
} from "@db/schema";
import { eq, and, or, desc, asc } from "drizzle-orm";
import { log } from "./vite";
import { z } from "zod";
import { sql } from "drizzle-orm";

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
        })
        .from(channels)
        .innerJoin(channelMembers, eq(channels.id, channelMembers.channelId))
        .where(eq(channelMembers.userId, req.user!.id))
        .orderBy(desc(channels.createdAt));

      res.json(userChannels);
    } catch (error) {
      log(`[ERROR] Failed to fetch channels: ${error}`);
      res.status(500).json({ message: "Failed to fetch channels" });
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

      res.json(channel);
    } catch (error) {
      log(`[ERROR] Failed to fetch channel: ${error}`);
      res.status(500).json({ message: "Failed to fetch channel" });
    }
  });

  // All channels API endpoint
  app.get("/api/channels/all", requireAuth, async (req, res) => {
    try {
      log(`[API] Fetching all channels`);
      const allChannels = await db
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
        })
        .from(channels)
        .orderBy(desc(channels.createdAt));

      res.json(allChannels);
    } catch (error) {
      log(`[ERROR] Failed to fetch all channels: ${error}`);
      res.status(500).json({ message: "Failed to fetch channels" });
    }
  });

  app.post("/api/channels", async (req, res) => {
    try {
      // Validate request body
      const result = createChannelSchema.safeParse(req.body);
      if (!result.success) {
        log(
          `[ERROR] Channel creation validation failed: ${result.error.issues.map((i) => i.message).join(", ")}`,
        );
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.issues.map((i) => i.message),
        });
      }

      const { name, description, isPrivate } = result.data;
      log(`[INFO] Creating channel "${name}" for user ${req.user!.id}`);

      // Start a transaction to ensure both operations succeed or fail together
      const channel = await db.transaction(async (tx) => {
        // Create the channel
        const [newChannel] = await tx
          .insert(channels)
          .values({
            name,
            description,
            isPrivate,
            createdById: req.user!.id,
          })
          .returning();

        log(`[INFO] Channel created with ID ${newChannel.id}`);

        // Add the creator as a channel member
        await tx.insert(channelMembers).values({
          channelId: newChannel.id,
          userId: req.user!.id,
        });

        log(`[INFO] Added creator as channel member`);
        return newChannel;
      });

      // Notify other users about the new channel creation
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
        const [message] = await db
          .insert(messages)
          .values({
            content,
            userId: req.user!.id,
            channelId: parseInt(req.params.channelId),
          })
          .returning();

        const [messageWithUser] = await db
          .select({
            message: messages,
            user: users,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(eq(messages.id, message.id))
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

        // Send message through WebSocket with proper typing
        ws.broadcast({
          type: "message",
          payload: fullMessage,
        });

        res.json(fullMessage);
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
  app.get("/api/users", async (req, res) => {
    try {
      // First get all users
      const allUsers = await db.select().from(users);

      // Then get unread message counts for the current user
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

      // Map the unread counts to users
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

      // Don't send password hash
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      log(`[ERROR] Failed to fetch user: ${error}`);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  return httpServer;
}