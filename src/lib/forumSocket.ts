import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, getActiveAuthToken, isExpressBackendAvailable } from './api';
import type { ForumSocketEvent } from '../types';

interface UseForumSocketOptions {
  enabled: boolean;
  activeRoomId: number | null;
  onEvent: (event: ForumSocketEvent) => void;
}

export function useForumSocket({ enabled, activeRoomId, onEvent }: UseForumSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState<'ws' | 'sse' | 'polling'>('polling');
  const wsRef = useRef<WebSocket | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const activeRoomRef = useRef<number | null>(activeRoomId);
  activeRoomRef.current = activeRoomId;

  const sendFrame = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const sendTyping = useCallback(
    (roomId: number, postId: number | null, isTyping: boolean) => {
      sendFrame({ type: 'typing', roomId, postId, isTyping });
    },
    [sendFrame]
  );

  const subscribeRoom = useCallback(
    (roomId: number) => {
      sendFrame({ type: 'subscribe:room', roomId });
    },
    [sendFrame]
  );

  useEffect(() => {
    if (activeRoomId && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe:room', roomId: activeRoomId }));
    }
  }, [activeRoomId]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    let disposed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let retryAttempt = 0;

    const startSseFallback = async () => {
      if (disposed) return;
      const token = await getActiveAuthToken(false);
      if (!token || token.startsWith('inbuilt.')) {
        setTransport('polling');
        return;
      }
      sseAbortRef.current?.abort();
      const ctrl = new AbortController();
      sseAbortRef.current = ctrl;
      try {
        const res = await fetch(apiUrl('/api/forum/events'), {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setTransport('polling');
          return;
        }
        setConnected(true);
        setTransport('sse');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split('\n\n');
          buf = blocks.pop() || '';
          for (const block of blocks) {
            const dataLine = block
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (dataLine) {
              try {
                const evt = JSON.parse(dataLine.slice(6)) as ForumSocketEvent;
                onEventRef.current(evt);
              } catch {
                // ignore malformed frame
              }
            }
          }
        }
      } catch {
        if (!disposed) {
          setConnected(false);
          setTransport('polling');
        }
      }
    };

    const connectWs = async () => {
      if (disposed) return;
      const hasExpress = await isExpressBackendAvailable();
      const token = await getActiveAuthToken(false);
      if (!hasExpress || !token || token.startsWith('inbuilt.')) {
        setConnected(false);
        setTransport('polling');
        return;
      }

      const base = apiUrl('/ws');
      let wsUrl = '';
      if (base.startsWith('http://') || base.startsWith('https://')) {
        wsUrl = base.replace(/^http/, 'ws');
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${proto}//${window.location.host}${base.startsWith('/') ? base : `/${base}`}`;
      }

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
          if (disposed) {
            ws.close();
            return;
          }
          retryAttempt = 0;
          const activeToken = await getActiveAuthToken(false);
          if (activeToken) {
            ws.send(JSON.stringify({ type: 'auth', token: activeToken }));
          }
          if (pingTimer) window.clearInterval(pingTimer);
          pingTimer = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
            }
          }, 22000);
        };

        ws.onmessage = (e) => {
          try {
            const payload = JSON.parse(String(e.data)) as ForumSocketEvent | { type: 'pong' };
            if (payload.type === 'pong') return;
            if (payload.type === 'ws:ready') {
              setConnected(true);
              setTransport('ws');
              sseAbortRef.current?.abort();
              if (activeRoomRef.current) {
                ws.send(
                  JSON.stringify({ type: 'subscribe:room', roomId: activeRoomRef.current })
                );
              }
            }
            onEventRef.current(payload);
          } catch {
            // ignore
          }
        };

        ws.onerror = () => {
          // handled on close
        };

        ws.onclose = () => {
          if (pingTimer) {
            window.clearInterval(pingTimer);
            pingTimer = null;
          }
          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          setConnected(false);
          if (disposed) return;
          if (retryAttempt >= 2) {
            void startSseFallback();
          }
          const delayMs = Math.min(18000, 1200 * Math.pow(2, retryAttempt));
          retryAttempt += 1;
          reconnectTimer = window.setTimeout(() => {
            void connectWs();
          }, delayMs);
        };
      } catch {
        void startSseFallback();
      }
    };

    void connectWs();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      sseAbortRef.current?.abort();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled]);

  return {
    connected,
    transport,
    sendTyping,
    subscribeRoom,
  };
}
