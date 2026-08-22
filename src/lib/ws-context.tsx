"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { WsMessage } from "@/lib/types";

type WsContextValue = {
  lastMessage: WsMessage | null;
  connected: boolean;
};

const WsContext = createContext<WsContextValue>({ lastMessage: null, connected: false });

export function WsProvider({ children }: { children: React.ReactNode }) {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        setLastMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      reconnectTimer.current = setTimeout(connect, 3_000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [connect]);

  return <WsContext.Provider value={{ lastMessage, connected }}>{children}</WsContext.Provider>;
}

export function useWs() {
  return useContext(WsContext);
}
