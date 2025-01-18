import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWebSocket(userId: number | undefined, token: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!userId || !token) return;

    function connect() {
      // Use the same host and port as the main application
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;

      // Create WebSocket URL with token as a query parameter for authentication
      const wsUrl = `${protocol}//${host}/ws?token=${token}`;
      console.log("[WS] Connecting to:", wsUrl);

      // Create WebSocket
      const websocket = new WebSocket(wsUrl);
      websocket.addEventListener("open", () => {
        console.log("[WS] WebSocket connected, sending auth check");
        websocket.send(
          JSON.stringify({
            type: "auth_check",
            payload: { userId },
          }),
        );
      });

      ws.current = websocket;

      websocket.onopen = () => {
        console.log("[WS] WebSocket connection established");
      };

      websocket.onerror = (error) => {
        console.error("[WS] WebSocket error:", error);
      };

      websocket.onclose = (event) => {
        console.log("[WS] WebSocket closed:", event.code, event.reason);
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log("[WS] Attempting to reconnect...");
          connect();
        }, 3000);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("[WS] WebSocket message received:", data);

          switch (data.type) {
            case "connected":
              console.log("[WS] Connection authenticated:", data.payload);
              break;
            case "message":
              queryClient.invalidateQueries({
                queryKey: ["/api/channels", data.payload.channelId, "messages"],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/channels/all"],
              });
              break;
            case "message_read":
              // Invalidate both channel messages and channel list to update read status
              queryClient.invalidateQueries({
                queryKey: ["/api/channels", data.payload.channelId, "messages"],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/channels/all"],
              });
              break;
            case "direct_message_read":
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.fromUserId],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.toUserId],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/users"],
              });
              break;
            case "direct_message":
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.fromUserId],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.toUserId],
              });
              break;
            case "message_reaction":
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.fromUserId],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.toUserId],
              });
              if (data.payload.channelId)
                queryClient.invalidateQueries({
                  queryKey: ["/api/channels", data.payload.channelId, "messages"],
                });
              break;
            case "message_deleted":
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.fromUserId],
              });
              queryClient.invalidateQueries({
                queryKey: ["/api/dm", data.payload.toUserId],
              });
              if (data.payload.channelId)
                queryClient.invalidateQueries({
                  queryKey: ["/api/channels", data.payload.channelId, "messages"],
                });
              queryClient.invalidateQueries({
                queryKey: ["/api/channels/all"],
              });
              break;
            case "presence":
              queryClient.invalidateQueries({
                queryKey: ["/api/users"],
              });
              break;
            case "channel_created":
              queryClient.invalidateQueries({
                queryKey: ["/api/channels/all"],
              });
              break;
            case "error":
              console.error("[WS] Server error:", data.payload.message);
              break;
          }
        } catch (error) {
          console.error("[WS] Error processing message:", error);
        }
      };
    }

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.close();
      }
    };
  }, [userId, token, queryClient]);

  const sendMessage = (type: string, payload: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn("[WS] WebSocket is not connected");
    }
  };

  return { sendMessage };
}