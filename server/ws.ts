import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { sessionStore, sessionSettings } from "./auth";
import type { SessionData } from "express-session";

interface ExtendedWebSocket extends WebSocket {
  userId?: number;
  isAlive: boolean;
}

type WSMessageType = "typing" | "message" | "direct_message" | "connected" | "presence" | "error";

interface WSMessage {
  type: WSMessageType;
  payload: {
    userId?: number;
    channelId?: number;
    message?: string;
    content?: string;
    status?: string;
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
    path: '/ws',
    verifyClient: async ({ req }, done) => {
      try {
        // Skip verification for Vite HMR
        if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
          return done(true);
        }

        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) {
          log("[WS] No cookie header found");
          done(false, 401, "Unauthorized");
          return;
        }

        const cookies = parseCookie(cookieHeader);
        const sid = cookies[sessionSettings.name!];
        if (!sid) {
          log("[WS] No session ID found in cookies");
          done(false, 401, "Unauthorized");
          return;
        }

        // Convert callback to Promise for proper async handling
        await new Promise<void>((resolve, reject) => {
          sessionStore.get(sid, (err, session) => {
            if (err) {
              log(`[WS] Session store error: ${err}`);
              done(false, 500, "Internal Server Error");
              reject(err);
              return;
            }

            const typedSession = session as ExtendedSessionData | null;
            if (!typedSession?.passport?.user) {
              log(`[WS] Invalid session: No user found`);
              done(false, 401, "Unauthorized");
              reject(new Error("Invalid session"));
              return;
            }

            log(`[WS] Session verified for user ${typedSession.passport.user}`);
            done(true);
            resolve();
          });
        });
      } catch (error) {
        log(`[WS] Error during client verification: ${error}`);
        done(false, 500, "Internal Server Error");
      }
    },
    handleProtocols: (protocols: Set<string>) => {
      // Accept Vite HMR protocol if present
      if (protocols.has('vite-hmr')) {
        return 'vite-hmr';
      }
      // For chat connections, accept without specific protocol
      return '';
    }
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
    log("[WS] New connection established");
    ws.isAlive = true;

    // Skip chat setup for Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      log("[WS] Vite HMR connection established");
      return;
    }

    // Extract session from cookie and set up the connection
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      log("[WS] No cookie header found in connection");
      ws.close(1008, "Unauthorized");
      return;
    }

    const cookies = parseCookie(cookieHeader);
    const sid = cookies[sessionSettings.name!];

    // Convert callback to Promise for proper async handling
    try {
      await new Promise<void>((resolve, reject) => {
        sessionStore.get(sid, (err, session) => {
          if (err) {
            log(`[WS] Session store error: ${err}`);
            reject(err);
            return;
          }

          const typedSession = session as ExtendedSessionData | null;
          if (!typedSession?.passport?.user) {
            log(`[WS] Invalid session: No user found`);
            reject(new Error("Invalid session"));
            return;
          }

          const userId = typedSession.passport.user;
          log(`[WS] Setting up connection for user ${userId}`);

          // Handle existing connection
          const existingClient = clients.get(userId);
          if (existingClient) {
            log(`[WS] Closing existing connection for user ${userId}`);
            existingClient.close(1000, "New connection established");
            clients.delete(userId);
          }

          // Set up new connection
          ws.userId = userId;
          clients.set(userId, ws);

          // Send initial connection success
          try {
            ws.send(JSON.stringify({
              type: "connected" as WSMessageType,
              payload: { userId, message: "Connected to server" }
            }));
          } catch (error) {
            log(`[WS] Error sending welcome message: ${error}`);
          }

          resolve();
        });
      });
    } catch (error) {
      log(`[WS] Session verification failed: ${error}`);
      ws.close(1008, "Unauthorized");
      return;
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      try {
        if (!ws.userId) {
          throw new Error("Not authenticated");
        }

        const message = JSON.parse(data.toString()) as WSMessage;
        log(`[WS] Received message type: ${message.type} from user ${ws.userId}`);

        switch (message.type) {
          case "typing":
            broadcast({
              type: "typing",
              payload: {
                userId: ws.userId,
                channelId: message.payload.channelId
              }
            });
            break;

          case "message":
            broadcast({
              type: "message",
              payload: {
                ...message.payload,
                userId: ws.userId
              }
            });
            break;

          default:
            log(`[WS] Unknown message type: ${message.type}`);
        }
      } catch (error) {
        log(`[WS] Error processing message: ${error}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "error" as WSMessageType,
            payload: { message: error instanceof Error ? error.message : "Invalid message format" }
          }));
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
          payload: { userId: ws.userId, status: "offline" }
        });
      }
    });
  });

  wss.on('close', () => {
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
    clients
  };
}