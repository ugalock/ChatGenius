import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { User } from "@db/schema";

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
    handleProtocols: (protocols, req) => {
      // Allow Vite HMR connections
      if (protocols.has('vite-hmr')) {
        return 'vite-hmr';
      }
      return '';
    }
  });
  const clients = new Map<number, ExtendedWebSocket>();

  wss.on("connection", (ws: ExtendedWebSocket, req) => {
    // Skip authentication for Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      return;
    }

    ws.on("message", async (data: string) => {
      try {
        const message: WSMessage = JSON.parse(data);

        switch (message.type) {
          case "auth":
            ws.userId = message.payload.userId;
            clients.set(message.payload.userId, ws);
            broadcast({
              type: "presence",
              payload: { userId: message.payload.userId, status: "online" }
            });
            break;

          case "message":
            broadcast({
              type: "message",
              payload: message.payload
            });
            break;

          case "typing":
            broadcast({
              type: "typing",
              payload: {
                userId: ws.userId,
                channelId: message.payload.channelId
              }
            });
            break;
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", () => {
      if (ws.userId) {
        clients.delete(ws.userId);
        broadcast({
          type: "presence",
          payload: { userId: ws.userId, status: "offline" }
        });
      }
    });
  });

  function broadcast(message: WSMessage, exclude?: number) {
    const data = JSON.stringify(message);
    clients.forEach((client, userId) => {
      if (userId !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  return {
    broadcast,
    clients
  };
}