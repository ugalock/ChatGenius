import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { channels, messages, channelMembers, directMessages, users } from "@db/schema";
import { eq, and, or, desc } from "drizzle-orm";

// Middleware to check authentication
function requireAuth(req: Express.Request, res: Express.Response, next: Function) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Channels - protected by auth middleware
  app.get("/api/channels", requireAuth, async (req, res) => {
    try {
      const userChannels = await db
        .select({
          id: channels.id,
          name: channels.name,
          description: channels.description,
          isPrivate: channels.isPrivate,
          createdAt: channels.createdAt,
          createdById: channels.createdById
        })
        .from(channels)
        .innerJoin(channelMembers, eq(channels.id, channelMembers.channelId))
        .where(eq(channelMembers.userId, req.user!.id))
        .orderBy(desc(channels.createdAt));

      res.json(userChannels);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch channels" });
    }
  });

  app.post("/api/channels", requireAuth, async (req, res) => {
    try {
      const { name, description, isPrivate } = req.body;

      // Start a transaction to ensure both operations succeed or fail together
      const result = await db.transaction(async (tx) => {
        // Create the channel
        const [channel] = await tx
          .insert(channels)
          .values({
            name,
            description,
            isPrivate: isPrivate || false,
            createdById: req.user!.id
          })
          .returning();

        // Add the creator as a channel member
        await tx.insert(channelMembers).values({
          channelId: channel.id,
          userId: req.user!.id
        });

        return channel;
      });

      res.json(result);
    } catch (error) {
      console.error("Error creating channel:", error);
      res.status(500).json({ message: "Failed to create channel" });
    }
  });

  // Messages
  app.get("/api/channels/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const channelMessages = await db
        .select({
          message: messages,
          user: users
        })
        .from(messages)
        .innerJoin(users, eq(messages.userId, users.id))
        .where(eq(messages.channelId, parseInt(req.params.channelId)))
        .orderBy(desc(messages.createdAt))
        .limit(50);

      res.json(channelMessages.map(({ message, user }) => ({ ...message, user })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/channels/:channelId/messages", requireAuth, async (req, res) => {
    try {
      const { content } = req.body;
      const [message] = await db
        .insert(messages)
        .values({
          content,
          userId: req.user!.id,
          channelId: parseInt(req.params.channelId)
        })
        .returning();

      const [messageWithUser] = await db
        .select({
          message: messages,
          user: users
        })
        .from(messages)
        .innerJoin(users, eq(messages.userId, users.id))
        .where(eq(messages.id, message.id))
        .limit(1);

      const fullMessage = { ...messageWithUser.message, user: messageWithUser.user };

      ws.broadcast({
        type: "message",
        payload: fullMessage
      });

      res.json(fullMessage);
    } catch (error) {
      res.status(500).json({ message: "Failed to post message" });
    }
  });

  // Direct Messages
  app.get("/api/dm/:userId", requireAuth, async (req, res) => {
    try {
      const dms = await db
        .select()
        .from(directMessages)
        .where(
          or(
            and(
              eq(directMessages.fromUserId, req.user!.id),
              eq(directMessages.toUserId, parseInt(req.params.userId))
            ),
            and(
              eq(directMessages.fromUserId, parseInt(req.params.userId)),
              eq(directMessages.toUserId, req.user!.id)
            )
          )
        )
        .orderBy(desc(directMessages.createdAt))
        .limit(50);

      res.json(dms);
    } catch (error) {
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
          toUserId: parseInt(req.params.userId)
        })
        .returning();

      ws.broadcast({
        type: "direct_message",
        payload: message
      });

      res.json(message);
    } catch (error) {
      res.status(500).json({ message: "Failed to post direct message" });
    }
  });

  // Users
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      res.json(allUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  return httpServer;
}