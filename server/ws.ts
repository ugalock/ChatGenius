import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./vite";
import { verifyToken } from "./auth";
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
        const token = url.searchParams.get("token");

        if (!token) {
          log("[WS] No token provided in URL parameters");
          done(false, 401, "Unauthorized");
          return;
        }

        const userId = verifyToken(token);
        if (!userId) {
          log("[WS] Invalid or expired token");
          done(false, 401, "Unauthorized");
          return;
        }

        log(`[WS] Token verified for user ${userId}`);
        done(true);
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
    const token = url.searchParams.get("token");
    const userId = token ? verifyToken(token) : null;

    if (!userId) {
      ws.close(1008, "Invalid token");
      return;
    }

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