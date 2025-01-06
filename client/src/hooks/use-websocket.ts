import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWebSocket(userId: number | undefined) {
  const ws = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const websocket = new WebSocket(`ws://${window.location.host}`);
    ws.current = websocket;

    websocket.onopen = () => {
      websocket.send(JSON.stringify({
        type: "auth",
        payload: { userId }
      }));
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);

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
      websocket.close();
    };
  }, [userId, queryClient]);

  const sendMessage = (type: string, payload: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }));
    }
  };

  return { sendMessage };
}
