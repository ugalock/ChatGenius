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

interface WSMessage {
  type: string;
  payload: any;
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
    handleProtocols: (protocols, request) => {
      // Handle Vite HMR protocol
      if (protocols && Array.from(protocols).includes('vite-hmr')) {
        log('[WS] Accepting Vite HMR connection');
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

  wss.on("connection", async (ws: ExtendedWebSocket, req) => {
    log("[WS] New connection established");
    ws.isAlive = true;

    // Skip chat-related setup for Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      log("[WS] Vite HMR connection detected");
      return;
    }

    // Extract session from cookie
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = parseCookie(cookieHeader);
      const sid = cookies[sessionSettings.name!];

      if (sid) {
        // Verify session
        sessionStore.get(sid, (err, session: ExtendedSessionData | null) => {
          if (err || !session?.passport?.user) {
            log(`[WS] Invalid session for WebSocket connection`);
            ws.close();
            return;
          }

          const userId = session.passport.user;
          log(`[WS] Session authenticated for user ${userId}`);

          // Handle existing connection
          const existingClient = clients.get(userId);
          if (existingClient) {
            log(`[WS] Closing existing connection for user ${userId}`);
            existingClient.close();
            clients.delete(userId);
          }

          // Set up new connection
          ws.userId = userId;
          clients.set(userId, ws);

          // Send initial connection success
          try {
            ws.send(JSON.stringify({
              type: "connected",
              payload: { userId, message: "Connected to server" }
            }));
          } catch (error) {
            log(`[WS] Error sending welcome message: ${error}`);
          }
        });
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Setup chat WebSocket handlers
    ws.on("message", (data) => {
      try {
        if (!ws.userId) {
          throw new Error("Not authenticated");
        }

        const message = JSON.parse(data.toString()) as WSMessage;
        log(`[WS] Received message type: ${message.type}`);

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
            type: "error",
            payload: { message: error instanceof Error ? error.message : "Invalid message format" }
          }));
        }
      }
    });

    ws.on("error", (error) => {
      log(`[WS] WebSocket error: ${error}`);
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