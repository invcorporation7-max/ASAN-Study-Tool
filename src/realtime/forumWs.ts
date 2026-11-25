import crypto from 'crypto';
import type http from 'http';
import type { Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { canUserAccessForumRoom, getUserSubscribedForumRoomIds } from '../db/forum.ts';
import { authenticateBearerToken, type AuthUserRecord } from '../middleware/auth.ts';
import type { ForumSocketEvent } from '../types.ts';

interface SocketClientState {
  connectionId: string;
  ws: WebSocket;
  userId: number | null;
  username: string;
  displayName: string;
  rooms: Set<number>;
  isAlive: boolean;
}

interface SseClientState {
  connectionId: string;
  res: Response;
  userId: number;
  rooms: Set<number>;
}

const wsClients = new Set<SocketClientState>();
const sseClients = new Set<SseClientState>();

function safeSendWs(ws: WebSocket, payload: ForumSocketEvent | { type: 'pong' } | { type: 'ws:error'; error: string }) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function safeSendSse(res: Response, payload: ForumSocketEvent) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch {
    // closed stream
  }
}

function broadcastRoomPresence(roomId: number) {
  const onlineSet = new Set<number>();
  for (const client of wsClients) {
    if (client.userId && client.rooms.has(roomId) && client.ws.readyState === WebSocket.OPEN) {
      onlineSet.add(client.userId);
    }
  }
  for (const sse of sseClients) {
    if (sse.rooms.has(roomId)) {
      onlineSet.add(sse.userId);
    }
  }
  const event: ForumSocketEvent = {
    type: 'presence:room',
    roomId,
    onlineUserIds: Array.from(onlineSet),
  };
  for (const client of wsClients) {
    if (client.userId && client.rooms.has(roomId)) {
      safeSendWs(client.ws, event);
    }
  }
}

export function emitForumRoomEvent(roomId: number, event: ForumSocketEvent, excludeUserId?: number) {
  for (const client of wsClients) {
    if (!client.userId) continue;
    if (excludeUserId && client.userId === excludeUserId) continue;
    if (client.rooms.has(roomId)) {
      safeSendWs(client.ws, event);
    }
  }
  for (const sse of sseClients) {
    if (excludeUserId && sse.userId === excludeUserId) continue;
    if (sse.rooms.has(roomId)) {
      safeSendSse(sse.res, event);
    }
  }
}

export function emitForumUserEvent(userId: number, event: ForumSocketEvent) {
  for (const client of wsClients) {
    if (client.userId === userId) {
      safeSendWs(client.ws, event);
    }
  }
  for (const sse of sseClients) {
    if (sse.userId === userId) {
      safeSendSse(sse.res, event);
    }
  }
}

export async function subscribeUserToRoomRealtime(userId: number, roomId: number) {
  for (const client of wsClients) {
    if (client.userId === userId) {
      client.rooms.add(roomId);
    }
  }
  for (const sse of sseClients) {
    if (sse.userId === userId) {
      sse.rooms.add(roomId);
    }
  }
  broadcastRoomPresence(roomId);
}

export async function registerSseForumClient(user: AuthUserRecord, res: Response): Promise<() => void> {
  const initialRooms = await getUserSubscribedForumRoomIds(user.id).catch(() => []);
  const client: SseClientState = {
    connectionId: crypto.randomUUID(),
    res,
    userId: user.id,
    rooms: new Set(initialRooms),
  };
  sseClients.add(client);
  safeSendSse(res, { type: 'ws:ready', userId: user.id, connectionId: client.connectionId });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch {
      // handled on close
    }
  }, 25000);

  return () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
    for (const rId of client.rooms) {
      broadcastRoomPresence(rId);
    }
  };
}

export function attachForumWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  const heartbeatInterval = setInterval(() => {
    for (const client of wsClients) {
      if (!client.isAlive) {
        client.ws.terminate();
        wsClients.delete(client);
        continue;
      }
      client.isAlive = false;
      try {
        client.ws.ping();
      } catch {
        // ignore ping failure
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const host = req.headers.host || 'localhost:3000';
      const parsed = new URL(req.url || '/', `http://${host}`);
      if (parsed.pathname !== '/ws') {
        return; // Do NOT touch Vite HMR or other upgrade paths
      }

      wss.handleUpgrade(req, socket, head, async (ws) => {
        const client: SocketClientState = {
          connectionId: crypto.randomUUID(),
          ws,
          userId: null,
          username: '',
          displayName: '',
          rooms: new Set<number>(),
          isAlive: true,
        };
        wsClients.add(client);

        const authenticateToken = async (rawToken: string) => {
          try {
            const authRes = await authenticateBearerToken(rawToken);
            if (!authRes?.dbUser) {
              safeSendWs(ws, { type: 'ws:error', error: 'Authentication failed' });
              ws.close(4001, 'Unauthorized');
              return;
            }
            client.userId = authRes.dbUser.id;
            client.username = authRes.dbUser.username || '';
            client.displayName = authRes.dbUser.displayName || 'Student';
            const roomIds = await getUserSubscribedForumRoomIds(authRes.dbUser.id);
            roomIds.forEach((id) => client.rooms.add(id));
            safeSendWs(ws, {
              type: 'ws:ready',
              userId: authRes.dbUser.id,
              connectionId: client.connectionId,
            });
            for (const id of client.rooms) {
              broadcastRoomPresence(id);
            }
          } catch {
            safeSendWs(ws, { type: 'ws:error', error: 'Authentication error' });
            ws.close(4001, 'Unauthorized');
          }
        };

        const queryToken = parsed.searchParams.get('token');
        if (queryToken) {
          void authenticateToken(queryToken);
        }

        ws.on('pong', () => {
          client.isAlive = true;
        });

        ws.on('message', async (rawData) => {
          client.isAlive = true;
          try {
            const msg = JSON.parse(rawData.toString()) as {
              type?: string;
              token?: string;
              roomId?: number;
              postId?: number | null;
              isTyping?: boolean;
            };
            if (!msg || typeof msg.type !== 'string') return;

            if (msg.type === 'ping') {
              safeSendWs(ws, { type: 'pong' });
              return;
            }

            if (msg.type === 'auth' && msg.token) {
              await authenticateToken(String(msg.token));
              return;
            }

            if (!client.userId) return;

            if (msg.type === 'subscribe:room' && Number.isFinite(Number(msg.roomId))) {
              const roomId = Number(msg.roomId);
              const access = await canUserAccessForumRoom(roomId, client.userId);
              if (access.allowed) {
                client.rooms.add(roomId);
                broadcastRoomPresence(roomId);
              }
              return;
            }

            if (msg.type === 'unsubscribe:room' && Number.isFinite(Number(msg.roomId))) {
              const roomId = Number(msg.roomId);
              client.rooms.delete(roomId);
              broadcastRoomPresence(roomId);
              return;
            }

            if (msg.type === 'typing' && Number.isFinite(Number(msg.roomId))) {
              const roomId = Number(msg.roomId);
              if (!client.rooms.has(roomId)) return;
              emitForumRoomEvent(
                roomId,
                {
                  type: 'typing:state',
                  roomId,
                  postId: msg.postId ? Number(msg.postId) : null,
                  userId: client.userId,
                  username: client.username,
                  displayName: client.displayName,
                  isTyping: Boolean(msg.isTyping),
                },
                client.userId
              );
            }
          } catch {
            // ignore malformed ws frame
          }
        });

        ws.on('close', () => {
          const leftRooms = Array.from(client.rooms);
          wsClients.delete(client);
          for (const rId of leftRooms) {
            broadcastRoomPresence(rId);
          }
        });
      });
    } catch {
      socket.destroy();
    }
  });
}
