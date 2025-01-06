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
      const protocolArray = protocols ? (Array.isArray(protocols) ? protocols : [protocols]) : [];
      if (protocolArray.includes('vite-hmr')) {
        return 'vite-hmr';
      }
      return protocolArray.length > 0 ? protocolArray[0] : '';
    }
  });

  const clients = new Map<number, ExtendedWebSocket>();

  wss.on("connection", (ws: ExtendedWebSocket, req) => {
    // Skip authentication for Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      return;
    }

    ws.on("message", (data) => {
      try {
        // Ensure proper UTF-8 decoding
        const message = JSON.parse(data.toString('utf-8')) as WSMessage;

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
        // Send error back to client
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "error",
            payload: { message: "Invalid message format" }
          }));
        }
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

    // Send initial connection success message
    ws.send(JSON.stringify({
      type: "connected",
      payload: { message: "Connected to server" }
    }));
  });

  function broadcast(message: WSMessage, exclude?: number) {
    const data = JSON.stringify(message);
    clients.forEach((client, userId) => {
      if (userId !== exclude && client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          console.error(`Failed to send message to client ${userId}:`, error);
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