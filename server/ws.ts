import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { sessionStore, sessionSettings } from "./auth";
import type { SessionData } from "express-session";
import { URL } from "url";

interface ExtendedWebSocket extends WebSocket {
  userId?: number;
  isAlive: boolean;
}

type WSMessageType =
  | "typing"
  | "message"
  | "direct_message"
  | "connected"
  | "presence"
  | "error"
  | "channel_created"
  | "auth_check";

interface WSMessage {
  type: WSMessageType;
  payload: {
    userId?: number;
    channelId?: number;
    message?: string;
    content?: string;
    status?: string;
    [key: string]: any;
  };
}

interface ExtendedSessionData extends SessionData {
  passport?: {
    user: number;
  };
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: async ({ req }, done) => {
      try {
        // Skip verification for Vite HMR
        if (req.headers["sec-websocket-protocol"] === "vite-hmr") {
          log("[WS] Vite HMR connection, skipping auth");
          return done(true);
        }

        const url = new URL(req.url || "", "ws://localhost");
        const userId = url.searchParams.get("userId");

        if (!userId) {
          log("[WS] No userId provided in URL parameters");
          done(false, 401, "Unauthorized");
          return;
        }

        log(`[WS] Incoming connection request headers: ${JSON.stringify(req.headers)}`);
        const cookieHeader = req.headers.cookie;

        if (!cookieHeader) {
          log("[WS] No cookie header found in request");
          done(false, 401, "Unauthorized");
          return;
        }

        try {
          const cookies = parseCookie(cookieHeader || "");
          const sidCookie = cookies[sessionSettings.name || "chat.sid"];

          if (!sidCookie) {
            log(`[WS] No session ID found in cookies`);
            done(false, 401, "Unauthorized");
            return;
          }

          // Convert callback to Promise for better async handling
          const session = await new Promise<ExtendedSessionData | null>((resolve, reject) => {
            sessionStore.get(sidCookie, (err, session) => {
              if (err) {
                reject(err);
                return;
              }
              resolve(session as ExtendedSessionData | null);
            });
          });

          if (!session) {
            log(`[WS] No session found for ID: ${sidCookie}`);
            done(false, 401, "Session not found");
            return;
          }

          if (!session.passport?.user) {
            log(`[WS] Invalid session: No user found in session data`);
            done(false, 401, "Unauthorized");
            return;
          }

          // Verify that the session user matches the requested userId
          if (session.passport.user !== parseInt(userId)) {
            log(`[WS] User ID mismatch: Session user ${session.passport.user} != Requested user ${userId}`);
            done(false, 401, "Unauthorized");
            return;
          }

          log(`[WS] Session verified for user ${session.passport.user}`);
          done(true);
        } catch (error) {
          log(`[WS] Cookie parsing error: ${error}`);
          done(false, 400, "Invalid cookie");
          return;
        }
      } catch (error) {
        log(`[WS] Error during client verification: ${error}`);
        done(false, 500, "Internal Server Error");
      }
    },
  });

  const clients = new Map<number, ExtendedWebSocket>();

  // Setup heartbeat to detect stale connections
  const interval = setInterval(() => {
    wss.clients.forEach((wsClient: WebSocket) => {
      const ws = wsClient as ExtendedWebSocket;
      if (!ws.isAlive) {
        if (ws.userId) {
          log(`[WS] Client ${ws.userId} failed heartbeat, terminating`);
          clients.delete(ws.userId);
        }
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("connection", async (wsClient: WebSocket, req) => {
    const ws = wsClient as ExtendedWebSocket;
    ws.isAlive = true;

    // Skip chat setup for Vite HMR connections
    if (req.headers["sec-websocket-protocol"] === "vite-hmr") {
      log("[WS] Vite HMR connection established");
      return;
    }

    const url = new URL(req.url || "", "ws://localhost");
    const userId = parseInt(url.searchParams.get("userId") || "0");
    ws.userId = userId;

    log(`[WS] Client connected for user ${userId}`);

    // Handle existing connection
    const existingClient = clients.get(userId);
    if (existingClient) {
      log(`[WS] Closing existing connection for user ${userId}`);
      existingClient.close(1000, "New connection established");
      clients.delete(userId);
    }

    clients.set(userId, ws);

    // Send initial connection success
    try {
      ws.send(
        JSON.stringify({
          type: "connected",
          payload: { userId, message: "Connected to server" },
        })
      );
    } catch (error) {
      log(`[WS] Error sending welcome message: ${error}`);
    }

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      try {
        if (!ws.userId) {
          throw new Error("Not authenticated");
        }

        const message = JSON.parse(data.toString()) as WSMessage;
        log(`[WS] Received message type: ${message.type} from user ${ws.userId}`);

        // Handle auth check message type
        if (message.type === "auth_check") {
          ws.send(
            JSON.stringify({
              type: "connected",
              payload: {
                userId: ws.userId,
                message: "Authentication successful",
              },
            })
          );
          return;
        }

        broadcast(message);
      } catch (error) {
        log(`[WS] Error processing message: ${error}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              payload: {
                message: error instanceof Error ? error.message : "Invalid message format",
              },
            })
          );
        }
      }
    });

    ws.on("error", (error) => {
      log(`[WS] WebSocket error for user ${ws.userId}: ${error}`);
    });

    ws.on("close", () => {
      if (ws.userId) {
        log(`[WS] User ${ws.userId} disconnected`);
        clients.delete(ws.userId);
        broadcast({
          type: "presence",
          payload: { userId: ws.userId, status: "offline" },
        });
      }
    });
  });

  wss.on("close", () => {
    clearInterval(interval);
  });

  function broadcast(message: WSMessage, exclude?: number) {
    const data = JSON.stringify(message);
    clients.forEach((client, userId) => {
      if (userId !== exclude && client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          log(`[WS] Failed to send message to client ${userId}: ${error}`);
          clients.delete(userId);
        }
      }
    });
  }

  return {
    broadcast,
    clients,
  };
}