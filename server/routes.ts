import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { channels, messages, channelMembers, directMessages, users } from "@db/schema";
import { eq, and, or, desc } from "drizzle-orm";

export function registerRoutes(app: Express): Server {
  setupAuth(app);  // Make sure auth is set up before other routes
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Channels
  app.get("/api/channels", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

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
      .where(eq(channelMembers.userId, req.user.id))
      .orderBy(desc(channels.createdAt));

    res.json(userChannels);
  });

  app.post("/api/channels", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    const { name, description, isPrivate } = req.body;
    const [channel] = await db
      .insert(channels)
      .values({
        name,
        description,
        isPrivate,
        createdById: req.user.id
      })
      .returning();

    await db.insert(channelMembers).values({
      channelId: channel.id,
      userId: req.user.id
    });

    res.json(channel);
  });

  // Messages
  app.get("/api/channels/:channelId/messages", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

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
  });

  app.post("/api/channels/:channelId/messages", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    const { content } = req.body;
    const [message] = await db
      .insert(messages)
      .values({
        content,
        userId: req.user.id,
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
  });

  // Direct Messages
  app.get("/api/dm/:userId", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    const dms = await db
      .select()
      .from(directMessages)
      .where(
        or(
          and(
            eq(directMessages.fromUserId, req.user.id),
            eq(directMessages.toUserId, parseInt(req.params.userId))
          ),
          and(
            eq(directMessages.fromUserId, parseInt(req.params.userId)),
            eq(directMessages.toUserId, req.user.id)
          )
        )
      )
      .orderBy(desc(directMessages.createdAt))
      .limit(50);

    res.json(dms);
  });

  app.post("/api/dm/:userId", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    const { content } = req.body;
    const [message] = await db
      .insert(directMessages)
      .values({
        content,
        fromUserId: req.user.id,
        toUserId: parseInt(req.params.userId)
      })
      .returning();

    ws.broadcast({
      type: "direct_message",
      payload: message
    });

    res.json(message);
  });

  // Users
  app.get("/api/users", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    const allUsers = await db.select().from(users);
    res.json(allUsers);
  });

  return httpServer;
}