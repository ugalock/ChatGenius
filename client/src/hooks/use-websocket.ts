import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useWebSocket(userId: number | undefined) {
  const ws = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!userId) return;

    function connect() {
      // Use the same host and port as the main application
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;

      // Create WebSocket URL and ensure credentials are included
      const wsUrl = new URL(`${protocol}//${host}/ws`);
      wsUrl.searchParams.set('userId', userId.toString());

      // Create WebSocket with credentials support
      const websocket = new WebSocket(wsUrl);
      websocket.addEventListener('open', () => {
        console.log('[WS] WebSocket connected, sending auth check');
        websocket.send(JSON.stringify({
          type: 'auth_check',
          payload: { userId }
        }));
      });

      ws.current = websocket;

      websocket.onopen = () => {
        console.log('[WS] WebSocket connection established');
      };

      websocket.onerror = (error) => {
        console.error('[WS] WebSocket error:', error);
      };

      websocket.onclose = (event) => {
        console.log('[WS] WebSocket closed:', event.code, event.reason);
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WS] Attempting to reconnect...');
          connect();
        }, 3000);
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WS] WebSocket message received:', data);

          switch (data.type) {
            case "connected":
              console.log('[WS] Connection authenticated:', data.payload);
              break;
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
            case "error":
              console.error('[WS] Server error:', data.payload.message);
              break;
          }
        } catch (error) {
          console.error('[WS] Error processing message:', error);
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
  }, [userId, queryClient]);

  const sendMessage = (type: string, payload: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WS] WebSocket is not connected');
    }
  };

  return { sendMessage };
}