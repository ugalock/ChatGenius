import { eq, and, or, desc, asc, sql, lt, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { requireAuth } from "./auth";
import { db } from "@db";
import { avatarService } from "@services";
import multer from "multer";
import * as path from "path";
import * as fs from "fs";
import express from "express";
import {
  channels,
  messages,
  channelMembers,
  directMessages,
  users,
  messageReads,
  type Attachment,
  type DirectMessage,
  type Message,
} from "@db/schema";
import { log } from "./vite";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  // fileFilter: (req, file, cb) => {
  //   // Allow images and PDFs
  //   if (file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
  //     cb(null, true);
  //   } else {
  //     cb(null, false);
  //   }
  // },
});

// Channel creation validation schema
const createChannelSchema = z.object({
  name: z.string().min(1, "Channel name is required"),
  description: z.string().optional(),
  isPrivate: z.boolean().default(false),
});

// Update message query param validation schema to include threadId
const messageQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.string().default("50"),
  threadId: z.string().optional(),
});

// Reaction schema
const reactionSchema = z.object({
  emoji: z.string(),
});

// WebSocket message types and payloads
interface BaseWSPayload {
  channelId?: number;
  userId?: number;
  messageId?: number;
}

interface MessagePayload extends BaseWSPayload {
  content: string;
  user: {
    id: number;
    username: string;
    avatar?: string | null;
    status?: string;
  };
}

interface ReactionPayload extends BaseWSPayload {
  reactions: Record<string, number[]>;
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const ws = setupWebSocket(httpServer);

  // Serve uploaded files
  app.use("/uploads", express.static(uploadsDir));

  // Protected API routes - must be authenticated
  app.use("/api/channels", requireAuth);
  app.use("/api/user", requireAuth);

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
                SELECT COUNT(messages.id)::integer
                FROM ${messages}
                WHERE channel_id = channels.id AND messages.user_id != ${req.user!.id}
                AND NOT EXISTS (
                  SELECT 1 FROM ${messageReads} mr
                  WHERE mr.message_id = messages.id
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

  // Add this new endpoint after the other channel endpoints
  app.get(
    "/api/channels/:channelId/read-messages",
    requireAuth,
    async (req, res) => {
      try {
        const channelId = parseInt(req.params.channelId);
        const userId = req.user!.id;

        // Get all read messages for this channel and user
        const readMessages = await db
          .select({
            messageId: messageReads.messageId,
            readAt: messageReads.readAt,
          })
          .from(messageReads)
          .innerJoin(messages, eq(messageReads.messageId, messages.id))
          .where(
            and(
              eq(messages.channelId, channelId),
              eq(messageReads.userId, userId),
            ),
          );

        res.json(readMessages);
      } catch (error) {
        log(`[ERROR] Failed to fetch read messages: ${error}`);
        res.status(500).json({ message: "Failed to fetch read messages" });
      }
    },
  );

  app.get(
    "/api/users/:userId/read-direct-messages",
    requireAuth,
    async (req, res) => {
      try {
        const userId = parseInt(req.params.userId);
        const toUserId = req.user!.id;

        // Get all read messages for this channel and user
        const readDMs = await db
          .select({
            id: directMessages.id,
          })
          .from(directMessages)
          .where(
            and(
              eq(directMessages.fromUserId, userId),
              eq(directMessages.toUserId, toUserId),
              eq(directMessages.isRead, true),
            ),
          );

        res.json(readDMs);
      } catch (error) {
        log(`[ERROR] Failed to fetch read messages: ${error}`);
        res.status(500).json({ message: "Failed to fetch read messages" });
      }
    },
  );
  
  // Messages with pagination and thread support
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

        const { before, after, limit, threadId } = queryResult.data;
        const channelId = parseInt(req.params.channelId);
        const messageLimit = Math.max(parseInt(limit), 50);

        let whereClause;
        if (threadId) {
          if (before) {
            whereClause = and(
              eq(messages.channelId, channelId),
              or(
                eq(messages.id, parseInt(threadId)),
                eq(messages.threadId, parseInt(threadId))
              ),
              lt(messages.id, parseInt(before))
            );
          } else if (after) {
            whereClause = and(
              eq(messages.channelId, channelId),
              or(
                eq(messages.id, parseInt(threadId)),
                eq(messages.threadId, parseInt(threadId))
              ),
              gt(messages.id, parseInt(after))
            );
          } else {
            whereClause = and(
              eq(messages.channelId, channelId),
              or(
                eq(messages.id, parseInt(threadId)),
                eq(messages.threadId, parseInt(threadId))
              )
            );
          }
        } else {
          if (before) {
            whereClause = and(
              eq(messages.channelId, channelId),
              lt(messages.id, parseInt(before)),
              sql`${messages.threadId} IS NULL`
            );
          } else if (after) {
            whereClause = and(
              eq(messages.channelId, channelId),
              gt(messages.id, parseInt(after)),
              sql`${messages.threadId} IS NULL`
            );
          } else {
            whereClause = and(
              eq(messages.channelId, channelId),
              sql`${messages.threadId} IS NULL`
            );
          }
        }
        // Build base query
        const query = db
          .select({
            id: messages.id,
            content: messages.content,
            channelId: messages.channelId,
            userId: messages.userId,
            threadId: messages.threadId,
            reactions: messages.reactions,
            attachments: messages.attachments,
            createdAt: messages.createdAt,
            updatedAt: messages.updatedAt,
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
              status: users.status,
            },
            replyCount: sql<number>`
              COALESCE(
                (
                  SELECT COUNT(m.id)::integer
                  FROM messages m
                  WHERE m.thread_id = ${messages.id}
                ),
                0
              )
            `,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(whereClause);

        // Execute query with order and limit
        const channelMessages = await query
          .orderBy(before ? desc(messages.createdAt) : asc(messages.createdAt))
          .limit(messageLimit);

        // Format messages
        const formattedMessages = channelMessages.map(msg => ({
          ...msg,
          reactions: msg.reactions || {},
          attachments: msg.attachments || [],
        }));

        // If we fetched with 'before', we need to reverse the order
        const orderedMessages = before
          ? [...formattedMessages].reverse()
          : formattedMessages;

        const response = {
          data: orderedMessages,
          nextCursor:
            channelMessages.length === messageLimit
              ? orderedMessages[0].id.toString()
              : null,
          prevCursor:
            channelMessages.length === messageLimit
              ? orderedMessages[orderedMessages.length - 1].id.toString()
              : null,
        };

        res.json(response);
      } catch (error) {
        log(`[ERROR] Failed to fetch messages: ${error}`);
        res.status(500).json({ message: "Failed to fetch messages" });
      }
    }
  );

  // Update message creation endpoint to handle file uploads
  app.post(
    "/api/channels/:channelId/messages",
    requireAuth,
    upload.array("files"),
    async (req, res) => {
      try {
        // Important: Ensure content is always a non-empty string
        const content = req.body.content || "(attachment)"; // Provide default content for file-only messages
        const threadId = req.body.threadId ? parseInt(req.body.threadId) : null;
        const channelId = parseInt(req.params.channelId);
        const files = req.files as Express.Multer.File[];

        let attachments: Attachment[] = [];
        if (files && files.length > 0) {
          attachments = files.map(file => ({
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype,
            url: `/uploads/${file.filename}`,
            uploadedAt: new Date().toISOString()
          }));
        }

        // Insert the message
        const [result] = await db
          .insert(messages)
          .values({
            content: content.trim(), // Ensure content is trimmed
            userId: req.user!.id,
            channelId,
            threadId,
            attachments: attachments.length > 0 ? attachments : null,
          })
          .returning() as Message[];

        await avatarService.indexUserMessage(result);

        if (threadId) {
          await db
          .insert(messageReads)
          .values({
            messageId: result.id,
            userId: req.user!.id,
          })
          .onConflictDoNothing();
        }

        // Get the full message with user details
        const [messageWithUser] = await db
          .select({
            message: messages,
            user: users,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(eq(messages.id, result.id))
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

        // Send message through WebSocket
        ws.broadcast({
          type: "message",
          payload: {
            ...fullMessage,
            channelId,
            content: fullMessage.content,
            user: fullMessage.user,
          },
        });

        const firstWord = content.split(" ")[0];
        if (firstWord.startsWith("@")) {
          const mentionedUsername = firstWord.substring(1);
          const [mentionedUser] = await db.select().from(users).where(eq(users.username, mentionedUsername));
          if (mentionedUser && mentionedUser.useAiResponse) {
            const responseText = await avatarService.generateAvatarResponse(mentionedUser.id, result);
            const [responseMessage] = await db
              .insert(messages)
              .values({
                content: responseText.trim(),
                userId: mentionedUser.id,
                channelId,
                threadId,
                attachments: null,
              })
              .returning() as Message[];

            await avatarService.indexUserMessage(responseMessage);

            if (threadId) {
              await db
              .insert(messageReads)
              .values({
                messageId: responseMessage.id,
                userId: mentionedUser.id,
              })
              .onConflictDoNothing();
            }

            ws.broadcast({
              type: "message",
              payload: {
                ...fullMessage,
                channelId,
                content: fullMessage.content,
                user: fullMessage.user,
              },
            });
          }
        }

        res.json(fullMessage);
      } catch (error) {
        console.error("Error posting message:", error);
        log(`[ERROR] Failed to post message: ${error}`);
        res.status(500).json({ message: "Failed to post message" });
      }
    }
  );

  // Direct Messages
  // Update the direct messages endpoint to support threading
  app.get("/api/dm/:userId", requireAuth, async (req, res) => {
    try {
      const queryResult = messageQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res.status(400).json({
          message: "Invalid query parameters",
          errors: queryResult.error.issues,
        });
      }

      const { before, after, limit, threadId } = queryResult.data;
      const toUserId = parseInt(req.params.userId);
      const messageLimit = Math.max(parseInt(limit), 50);

      let whereClause = or(
        and(
          eq(directMessages.fromUserId, req.user!.id),
          eq(directMessages.toUserId, toUserId),
        ),
        and(
          eq(directMessages.fromUserId, toUserId),
          eq(directMessages.toUserId, req.user!.id),
        ),
      );
      if (threadId) {
        if (before) {
          whereClause = and(
            whereClause,
            or(
              eq(directMessages.id, parseInt(threadId)),
              eq(directMessages.threadId, parseInt(threadId))
            ),
            lt(directMessages.id, parseInt(before))
          );
        } else if (after) {
          whereClause = and(
            whereClause,
            or(
              eq(directMessages.id, parseInt(threadId)),
              eq(directMessages.threadId, parseInt(threadId))
            ),
            gt(directMessages.id, parseInt(after))
          );
        } else {
          whereClause = and(
            whereClause,
            or(
              eq(directMessages.id, parseInt(threadId)),
              eq(directMessages.threadId, parseInt(threadId))
            )
          );
        }
      } else {
        if (before) {
          whereClause = and(
            whereClause,
            sql`${directMessages.threadId} IS NULL`,
            lt(directMessages.id, parseInt(before))
          );
        } else if (after) {
          whereClause = and(
            whereClause,
            sql`${directMessages.threadId} IS NULL`,
            gt(directMessages.id, parseInt(after))
          );
        } else {
          whereClause = and(
            whereClause,
            sql`${directMessages.threadId} IS NULL`
          );
        }
      }
      let baseQuery = db
        .select({
          id: directMessages.id,
          content: directMessages.content,
          fromUserId: directMessages.fromUserId,
          toUserId: directMessages.toUserId,
          threadId: directMessages.threadId,
          attachments: directMessages.attachments,
          reactions: directMessages.reactions,
          isRead: directMessages.isRead,
          createdAt: directMessages.createdAt,
          updatedAt: directMessages.updatedAt,
          user: {
            id: users.id,
            username: users.username,
            avatar: users.avatar,
            status: users.status,
          },
          replyCount: sql<number>`
            COALESCE(
              CAST((
                SELECT COUNT(*)
                FROM ${directMessages} replies
                WHERE replies.thread_id = ${directMessages.id}
              ) AS integer),
              0
            )
          `,
        })
        .from(directMessages)
        .innerJoin(users, eq(directMessages.fromUserId, users.id))
        .where(whereClause);

      // Get messages ordered by creation time
      const DMs = await baseQuery
        .orderBy(before ? desc(directMessages.createdAt) : asc(directMessages.createdAt))
        .limit(messageLimit);

      // Ensure reactions are properly formatted
      const formattedDMs = DMs.map(dm => ({
        ...dm,
        reactions: dm.reactions || {},
        attachments: dm.attachments || [],
      }));

      // If we fetched with 'before', we need to reverse the order
      const orderedDMs = before ? [...formattedDMs].reverse() : formattedDMs;

      const response = {
        data: orderedDMs,
        nextCursor:
          DMs.length === messageLimit ? orderedDMs[0].id.toString() : null,
        prevCursor:
          DMs.length === messageLimit
            ? orderedDMs[orderedDMs.length - 1].id.toString()
            : null,
      };

      res.json(response);
    } catch (error) {
      log(`[ERROR] Failed to fetch direct messages: ${error}`);
      res.status(500).json({ message: "Failed to fetch direct messages" });
    }
  });

  // Update direct message creation endpoint to handle file uploads
  app.post(
    "/api/dm/:userId",
    requireAuth,
    upload.array("files"),
    async (req, res) => {
      try {
        const content = req.body.content || "(attachment)"; // Provide default content for file-only messages
        const threadId = req.body.threadId ? parseInt(req.body.threadId) : null;
        const files = req.files as Express.Multer.File[];

        let attachments: Attachment[] = [];
        if (files && files.length > 0) {
          attachments = files.map(file => ({
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype,
            url: `/uploads/${file.filename}`,
            uploadedAt: new Date().toISOString()
          }));
        }

        // Insert the direct message
        const [message] = await db
          .insert(directMessages)
          .values({
            content,
            fromUserId: req.user!.id,
            toUserId: parseInt(req.params.userId),
            threadId,
            attachments: attachments.length > 0 ? attachments : null,
            isRead: threadId ? true : false,
          })
          .returning() as DirectMessage[];

        await avatarService.indexUserMessage(message);

        // Get the full message with user details
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
        
        const [mentionedUser] = await db.select().from(users).where(eq(users.id, message.toUserId));
        if (mentionedUser && mentionedUser.useAiResponse) {
          const responseText = await avatarService.generateAvatarResponse(mentionedUser.id, message);
          const [responseMessage] = await db
          .insert(directMessages)
          .values({
            content: responseText,
            fromUserId: mentionedUser.id,
            toUserId: req.user!.id,
            threadId,
            attachments: null,
            isRead: threadId ? true : false,
          })
          .returning() as DirectMessage[];

          await avatarService.indexUserMessage(responseMessage);

          ws.broadcast({
            type: "direct_message",
            payload: fullMessage,
          });
        }

        res.json(fullMessage);
      } catch (error) {
        console.error("Error posting direct message:", error);
        log(`[ERROR] Failed to post direct message: ${error}`);
        res.status(500).json({ message: "Failed to post direct message" });
      }
    }
  );

  // Users
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await db.select().from(users);
      // If a user's AI profile is more than 3 days old it should be updated
      // for (const user of allUsers) {
      //   const dateDiff = new Date().getTime() - user.aiUpdatedAt!.getTime();
      //   if (dateDiff > 1000 * 60 * 60 * 24 * 3) {
      //     const persona = await avatarService.createAvatarPersona(user.id);
      //     await avatarService.configureAvatar(persona);
      //     await db.update(users).set({ aiUpdatedAt: new Date() }).where(eq(users.id, user.id));
      //   }
      // }
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
      const channelId = req.body.channelId;
      const userId = req.body.userId;
      if (channelId) {
        // Verify the message exists
        const [message] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        await db
          .insert(messageReads)
          .values({
            messageId,
            userId: req.user!.id,
          })
          .onConflictDoNothing();

        // Broadcast read status update
        ws.broadcast({
          type: "message_read",
          payload: {
            messageId,
            userId: req.user!.id,
            channelId: message.channelId ?? undefined,
          },
        });
      } else if (userId) {
        const [message] = await db
          .select()
          .from(directMessages)
          .where(eq(directMessages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        await db
          .update(directMessages)
          .set({ isRead: true })
          .where(eq(directMessages.id, messageId));

        ws.broadcast({
          type: "direct_message_read",
          payload: {
            fromUserId: message.fromUserId,
            toUserId: message.toUserId,
          },
        });
      } else {
        return res.status(400).json({ message: "Invalid request" });
      }

      res.json({ message: "Message marked as read" });
    } catch (error) {
      log(`[ERROR] Failed to mark message as read: ${error}`);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  // Update the reaction endpoint to handle both message types
  app.post("/api/messages/:messageId/react", requireAuth, async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const result = reactionSchema.safeParse(req.body);
      const { isDirectMessage, toUserId, fromUserId } = req.body;

      if (!result.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: result.error.issues.map((i) => i.message),
        });
      }

      const { emoji } = result.data;
      const userId = req.user!.id;

      let message;
      let isDirectMessageType = false;

      // Try to find the message in channel messages first if not explicitly a DM
      if (!isDirectMessage) {
        [message] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, messageId))
          .limit(1);
      }

      // If not found in channel messages or explicitly a DM, check direct messages
      if (!message || isDirectMessage) {
        [message] = await db
          .select()
          .from(directMessages)
          .where(eq(directMessages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        isDirectMessageType = true;
      }

      // Initialize or update reactions
      const currentReactions = (message.reactions as Record<string, number[]>) || {};
      const userIds = currentReactions[emoji] || [];

      // Toggle reaction
      const updatedUserIds = userIds.includes(userId)
        ? userIds.filter((id) => id !== userId)
        : [...userIds, userId];

      const updatedReactions = {
        ...currentReactions,
        [emoji]: updatedUserIds,
      };

      // Remove emoji key if no users are reacting with it anymore
      if (updatedUserIds.length === 0) {
        delete updatedReactions[emoji];
      }

      // Update the appropriate message type
      let updatedMessage;
      if (isDirectMessageType) {
        [updatedMessage] = await db
          .update(directMessages)
          .set({
            reactions: updatedReactions,
          })
          .where(eq(directMessages.id, messageId))
          .returning();
      } else {
        [updatedMessage] = await db
          .update(messages)
          .set({
            reactions: updatedReactions,
          })
          .where(eq(messages.id, messageId))
          .returning();
      }

      //      // Broadcast reaction update with the correct message type
      ws.broadcast({
        type: "message_reaction",
        payload: {
          messageId,
          reactions: updatedReactions,
          userId,
          user: req.user,
          channelId: "channelId" in message ? message.channelId! : undefined,
          isDirectMessage: isDirectMessageType,
          toUserId: toUserId,
          fromUserId: fromUserId,
        },
      });

      res.json(updatedMessage);
    } catch (error) {
      log(`[ERROR] Failed to update message reaction: ${error}`);
      res.status(500).json({ message: "Failed to update message reaction" });
    }
  });

  // Add profile update endpoint after the other user routes
  app.patch("/api/users/profile", requireAuth, upload.single("avatar"), async (req, res) => {
    try {
      const userId = req.user!.id;
      const { bio, personalityTraits, responseStyle, writingStyle, useAiResponse } = req.body;
      const avatarFile = req.file;

      // Prepare update data
      const updateData: { bio?: string; avatar?: string; useAiResponse?: boolean } = {};
      if (bio !== undefined) {
        updateData.bio = bio;
      }
      if (avatarFile) {
        updateData.avatar = `/uploads/${avatarFile.filename}`;
      }
      if (useAiResponse !== undefined) {
        updateData.useAiResponse = useAiResponse === "true";
      }

      // Update user profile
      const [updatedUser] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();
      // Remove password from response
      const { password, ...userWithoutPassword } = updatedUser;

      const currentConfig = await avatarService.getAvatarConfig(userId);
      if (currentConfig.personalityTraits !== personalityTraits || currentConfig.responseStyle !== responseStyle || currentConfig.writingStyle !== writingStyle) {
        // Update avatar config
        await avatarService.updateAvatarConfig(userId, JSON.parse(personalityTraits), responseStyle, writingStyle);
        await db.update(users).set({ aiUpdatedAt: new Date() }).where(eq(users.id, userId));
        res.json({ avatarConfig: await avatarService.getAvatarConfig(userId), ...userWithoutPassword });
      } else {
        res.json({ avatarConfig: currentConfig, ...userWithoutPassword });
      }

    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Add these new routes after the existing message routes

  // Edit message endpoint
  app.patch("/api/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const { content, isDirectMessage } = req.body;
      const userId = req.user!.id;

      if (!content || content.trim() === "") {
        return res.status(400).json({ message: "Message content is required" });
      }

      if (isDirectMessage) {
        // Handle direct message edit
        const [message] = await db
          .select()
          .from(directMessages)
          .where(eq(directMessages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        // Check if user owns the message
        if (message.fromUserId !== userId) {
          return res.status(403).json({ message: "Unauthorized to edit this message" });
        }

        // Update the message
        const [updatedMessage] = await db
          .update(directMessages)
          .set({
            content: content.trim(),
            updatedAt: new Date(),
          })
          .where(eq(directMessages.id, messageId))
          .returning();

        // Get user details for the response
        const [messageWithUser] = await db
          .select({
            message: directMessages,
            user: users,
          })
          .from(directMessages)
          .innerJoin(users, eq(directMessages.fromUserId, users.id))
          .where(eq(directMessages.id, messageId))
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

        // Broadcast the update
        ws.broadcast({
          type: "direct_message",
          payload: fullMessage,
        });

        res.json(fullMessage);
      } else {
        // Handle channel message edit
        const [message] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        // Check if user owns the message
        if (message.userId !== userId) {
          return res.status(403).json({ message: "Unauthorized to edit this message" });
        }

        // Update the message
        const [updatedMessage] = await db
          .update(messages)
          .set({
            content: content.trim(),
            updatedAt: new Date(),
          })
          .where(eq(messages.id, messageId))
          .returning();

        // Get user details for the response
        const [messageWithUser] = await db
          .select({
            message: messages,
            user: users,
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(eq(messages.id, messageId))
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

        // Broadcast the update
        ws.broadcast({
          type: "message",
          payload: {
            ...fullMessage,
            channelId: message.channelId!,
            content: fullMessage.content,
            user: fullMessage.user,
          },
        });

        res.json(fullMessage);
      }
    } catch (error) {
      log(`[ERROR] Failed to edit message: ${error}`);
      res.status(500).json({ message: "Failed to edit message" });
    }
  });

  // Delete message endpoint
  app.delete("/api/messages/:messageId", requireAuth, async (req, res) => {
    try {
      const messageId = parseInt(req.params.messageId);
      const { isDirectMessage } = req.body;
      const userId = req.user!.id;

      let message : Message | DirectMessage;
      if (isDirectMessage) {
        // Handle direct message deletion
        [message] = await db
          .select()
          .from(directMessages)
          .where(eq(directMessages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        // Check if user owns the message
        if (message.fromUserId !== userId) {
          return res.status(403).json({ message: "Unauthorized to delete this message" });
        }

        // Delete the message
        await db
          .delete(directMessages)
          .where(eq(directMessages.id, messageId));

        // Broadcast the deletion
        ws.broadcast({
          type: "message_deleted",
          payload: {
            messageId,
            fromUserId: message.fromUserId,
            toUserId: message.toUserId,
          },
        });
      } else {
        // Handle channel message deletion
        [message] = await db
          .select()
          .from(messages)
          .where(eq(messages.id, messageId))
          .limit(1);

        if (!message) {
          return res.status(404).json({ message: "Message not found" });
        }

        // Check if user owns the message
        if (message.userId !== userId) {
          return res.status(403).json({ message: "Unauthorized to delete this message" });
        }

        await db
          .delete(messageReads)
          .where(eq(messageReads.messageId, messageId));

        // Delete the message
        await db
          .delete(messages)
          .where(eq(messages.id, messageId));

        // Broadcast the deletion
        ws.broadcast({
          type: "message_deleted",
          payload: {
            messageId,
            channelId: message.channelId!,
          },
        });
      }
      if (message) {
        // Delete any attachments from the server
        const attachments = message.attachments || [];
        for (const attachment of attachments) {
          const filePath = path.join(process.cwd(), attachment.url);
          await fs.promises.unlink(filePath);
        }
        await avatarService.deleteUserMessage(message);
      }
      
      res.json({ message: "Message deleted successfully" });

    } catch (error) {
      log(`[ERROR] Failed to delete message: ${error}`);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // Add these routes for direct messages
  app.patch("/api/dm/:messageId", requireAuth, async (req, res) => {
    req.body.isDirectMessage = true;
    return app._router.handle(req, res, () => {});
  });

  app.delete("/api/dm/:messageId", requireAuth, async (req, res) => {
    req.body.isDirectMessage = true;
    return app._router.handle(req, res, () => {});
  });

  app.get("/api/messages/:messageId/attachments/:attachmentIdx", requireAuth, async (req, res) => {
    const messageId = parseInt(req.params.messageId);
    const attachmentIdx = parseInt(req.params.attachmentIdx);
    let message : Message | DirectMessage;
    let isDirectMessage = false;
    [message] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1) as Message[];
    if (!message) {
      [message] = await db
        .select()
        .from(directMessages)
        .where(eq(directMessages.id, messageId))
        .limit(1) as DirectMessage[];
      isDirectMessage = true;
    }
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    const attachment = message.attachments![attachmentIdx];
    const summary = await avatarService.attachmentSummary(message, attachment);
    const content = `${isDirectMessage ? "[ @ai ] " : ""}Here is a summary of ${attachment.fileName}:
    ${summary}`;
    if (!isDirectMessage) {
      // Insert the message
      const [result] = await db
        .insert(messages)
        .values({
          content: content,
          userId: 3,
          channelId: "channelId" in message ? message.channelId : null,
          threadId: message.id,
          attachments: null,
        })
        .returning() as Message[];

      await avatarService.indexUserMessage(result);

      await db
        .insert(messageReads)
        .values({
          messageId: result.id,
          userId: req.user!.id,
        })
        .onConflictDoNothing();

      // Get the full message with user details
      const [messageWithUser] = await db
        .select({
          message: messages,
          user: users,
        })
        .from(messages)
        .innerJoin(users, eq(messages.userId, users.id))
        .where(eq(messages.id, result.id))
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

      // Send message through WebSocket
      ws.broadcast({
        type: "message",
        payload: {
          ...fullMessage,
          channelId: "channelId" in message ? message.channelId! : undefined,
          content: fullMessage.content,
          user: fullMessage.user,
        },
      });
    } else if ("fromUserId" in message) {
      // Insert the direct message
      const [result] = await db
        .insert(directMessages)
        .values({
          content: content,
          fromUserId: message.fromUserId,
          toUserId: message.toUserId,
          threadId: message.id,
          attachments: null,
          isRead: true,
        })
        .returning() as DirectMessage[];

      await avatarService.indexUserMessage(result);

      // Get the full message with user details
      const [messageWithUser] = await db
        .select({
          message: directMessages,
          user: users,
        })
        .from(directMessages)
        .innerJoin(users, eq(directMessages.fromUserId, users.id))
        .where(eq(directMessages.id, result.id))
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
    }
    res.json({ message: "Success" });
  });

  // Search endpoint
  app.post("/api/search", requireAuth, async (req, res) => {
    try {
      const query = req.body.searchTerm;
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }
      const channelId = req.body.channelId ? req.body.channelId : null;
      const userId = req.body.userId ? req.body.userId : null;
      const searchOptions = req.body.searchOptions ? req.body.searchOptions : [];
      // console.log("searchOptions", searchOptions);

      if (searchOptions) {
        const { msg_ids, dm_ids } = await avatarService.search(query, {channelId, fromUserId: req.user!.id, toUserId: userId, fileTypes: searchOptions});
        const [channelResults, dmResults] = await Promise.all([
          // Search channel messages
          db.select({
            id: messages.id,
            content: messages.content,
            channelId: messages.channelId,
            threadId: messages.threadId,
            attachments: messages.attachments,
            createdAt: messages.createdAt,
            type: sql<'channel'>`'channel'`.as('type'),
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
            .from(messages)
            .innerJoin(users, eq(messages.userId, users.id))
            .innerJoin(channelMembers, eq(messages.channelId, channelMembers.channelId))
            .where(and(
              eq(channelMembers.userId, req.user!.id),
              inArray(messages.id, msg_ids)
            ))
            .orderBy(desc(messages.createdAt)),

          // Search DMs
          db.select({
            id: directMessages.id,
            content: directMessages.content,
            fromUserId: directMessages.fromUserId,
            toUserId: directMessages.toUserId,
            threadId: directMessages.threadId,
            attachments: directMessages.attachments,
            createdAt: directMessages.createdAt,
            type: sql<'dm'>`'dm'`.as('type'),
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
            .from(directMessages)
            .innerJoin(users, eq(directMessages.fromUserId, users.id))
            .where(and(
              or(
                eq(directMessages.fromUserId, req.user!.id),
                eq(directMessages.toUserId, req.user!.id)
              ),
              inArray(directMessages.id, dm_ids)
            ))
            .orderBy(desc(directMessages.createdAt))
        ]);

        // Combine and sort results
        const allResults = [...channelResults, ...dmResults]
          .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());

        return res.json(allResults);
      }

      // Build base search condition
      const searchCondition = sql`(
        content ILIKE ${`%${query}%`} OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(attachments, '[]'::jsonb)) att
          WHERE att->>'fileName' ILIKE ${`%${query}%`}
        )
      )`;

      if (channelId) {
        // Channel-specific search
        const results = await db
          .select({
            id: messages.id,
            content: messages.content,
            channelId: messages.channelId,
            threadId: messages.threadId,
            attachments: messages.attachments,
            createdAt: messages.createdAt,
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .where(and(eq(messages.channelId, channelId), searchCondition))
          .orderBy(desc(messages.createdAt));

        res.json(results);

      } else if (userId) {
        // DM-specific search
        const results = await db
          .select({
            id: directMessages.id,
            content: directMessages.content,
            fromUserId: directMessages.fromUserId,
            toUserId: directMessages.toUserId,
            threadId: directMessages.threadId,
            attachments: directMessages.attachments,
            createdAt: directMessages.createdAt,
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
          .from(directMessages)
          .innerJoin(users, eq(directMessages.fromUserId, users.id))
          .where(
            and(
              or(
                and(
                  eq(directMessages.fromUserId, req.user!.id),
                  eq(directMessages.toUserId, userId)
                ),
                and(
                  eq(directMessages.fromUserId, userId),
                  eq(directMessages.toUserId, req.user!.id)
                )
              ),
              searchCondition
            )
          )
          .orderBy(desc(directMessages.createdAt));

        res.json(results);

      } else {
        // Global search across all accessible messages
        const [channelResults, dmResults] = await Promise.all([
          // Search channel messages
          db.select({
            id: messages.id,
            content: messages.content,
            channelId: messages.channelId,
            threadId: messages.threadId,
            attachments: messages.attachments,
            createdAt: messages.createdAt,
            type: sql<'channel'>`'channel'`.as('type'),
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
          .from(messages)
          .innerJoin(users, eq(messages.userId, users.id))
          .innerJoin(channelMembers, eq(messages.channelId, channelMembers.channelId))
          .where(and(
            eq(channelMembers.userId, req.user!.id),
            searchCondition
          ))
          .orderBy(desc(messages.createdAt)),

          // Search DMs
          db.select({
            id: directMessages.id,
            content: directMessages.content,
            fromUserId: directMessages.fromUserId,
            toUserId: directMessages.toUserId,
            threadId: directMessages.threadId,
            attachments: directMessages.attachments,
            createdAt: directMessages.createdAt,
            type: sql<'dm'>`'dm'`.as('type'),
            user: {
              id: users.id,
              username: users.username,
              avatar: users.avatar,
            },
          })
          .from(directMessages)
          .innerJoin(users, eq(directMessages.fromUserId, users.id))
          .where(and(
            or(
              eq(directMessages.fromUserId, req.user!.id),
              eq(directMessages.toUserId, req.user!.id)
            ),
            searchCondition
          ))
          .orderBy(desc(directMessages.createdAt))
        ]);

        // Combine and sort results
        const allResults = [...channelResults, ...dmResults]
          .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime());

        res.json(allResults);
      }
    } catch (error) {
      log(`[ERROR] Search failed: ${error}`);
      res.status(500).json({ message: "Search failed" });
    }
  });

  return httpServer;
}