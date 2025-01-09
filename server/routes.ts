import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { requireAuth } from "./auth";
import { db } from "@db";
import {
  messages,
  users,
} from "@db/schema";
import { eq, and, lt, gt, desc, asc } from "drizzle-orm";
import { log } from "./vite";
import { z } from "zod";

// Message query param validation schema
const messageQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.string().default("50"),
});

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Protected API routes
  app.use("/api/channels", requireAuth);
  app.use("/api/users", requireAuth);

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


  // Get messages with pagination
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

        let baseQuery = db
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

        let query = baseQuery;

        // Add pagination conditions
        if (before) {
          query = baseQuery.where(lt(messages.id, parseInt(before)));
        } else if (after) {
          query = baseQuery.where(gt(messages.id, parseInt(after)));
        }

        // Get messages ordered by creation time
        const channelMessages = await query
          .orderBy(before ? desc(messages.createdAt) : asc(messages.createdAt))
          .limit(messageLimit);

        // If we fetched with 'before', we need to reverse the order to maintain
        // chronological order (oldest first)
        const orderedMessages = before
          ? [...channelMessages].reverse()
          : channelMessages;

        const response = {
          data: orderedMessages,
          nextCursor:
            channelMessages.length === messageLimit
              ? orderedMessages[orderedMessages.length - 1].id.toString()
              : null,
          prevCursor:
            channelMessages.length === messageLimit
              ? orderedMessages[0].id.toString()
              : null,
        };

        res.json(response);
      } catch (error) {
        log(`[ERROR] Failed to fetch messages: ${error}`);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    },
  );

  return httpServer;
}