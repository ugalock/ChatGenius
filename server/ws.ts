import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { log } from "./vite";

interface ExtendedWebSocket extends WebSocket {
  userId?: number;
}

interface WSMessage {
  type: string;
  payload: any;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    path: '/',
    handleProtocols: (protocols, request) => {
      // Handle Vite HMR protocol
      if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
        log('[WS] Accepting Vite HMR connection');
        return 'vite-hmr';
      }
      // For chat connections, accept without specific protocol
      return '';
    }
  });

  const clients = new Map<number, ExtendedWebSocket>();

  wss.on("connection", (ws: ExtendedWebSocket, req) => {
    log("[WS] New connection established");

    // Skip chat-related setup for Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      log("[WS] Vite HMR connection detected");
      return;
    }

    // Setup chat WebSocket handlers
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString('utf-8')) as WSMessage;
        log(`[WS] Received message type: ${message.type}`);

        switch (message.type) {
          case "auth":
            ws.userId = message.payload.userId;
            clients.set(message.payload.userId, ws);
            log(`[WS] User ${message.payload.userId} authenticated`);
            broadcast({
              type: "presence",
              payload: { userId: message.payload.userId, status: "online" }
            });
            break;

          case "message":
            if (!ws.userId) {
              throw new Error("Not authenticated");
            }
            broadcast({
              type: "message",
              payload: message.payload
            });
            break;

          case "typing":
            if (!ws.userId) {
              throw new Error("Not authenticated");
            }
            broadcast({
              type: "typing",
              payload: {
                userId: ws.userId,
                channelId: message.payload.channelId
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

    // Send initial connection success message
    try {
      ws.send(JSON.stringify({
        type: "connected",
        payload: { message: "Connected to server" }
      }));
    } catch (error) {
      log(`[WS] Error sending welcome message: ${error}`);
    }
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