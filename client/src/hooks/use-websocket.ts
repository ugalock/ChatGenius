import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWebSocket(userId: number | undefined) {
  const ws = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    // Use the same host and port as the main application
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const websocket = new WebSocket(`${protocol}//${window.location.host}`);
    ws.current = websocket;

    websocket.onopen = () => {
      console.log('WebSocket connected');
      websocket.send(JSON.stringify({
        type: "auth",
        payload: { userId }
      }));
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WebSocket message received:', data);

      switch (data.type) {
        case "message":
          queryClient.invalidateQueries({
            queryKey: ["/api/channels", data.payload.channelId, "messages"]
          });
          break;
        case "direct_message":
          queryClient.invalidateQueries({
            queryKey: ["/api/dm", data.payload.fromUserId]
          });
          break;
        case "presence":
          queryClient.invalidateQueries({
            queryKey: ["/api/users"]
          });
          break;
      }
    };

    return () => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, [userId, queryClient]);

  const sendMessage = (type: string, payload: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('WebSocket is not connected');
    }
  };

  return { sendMessage };
}