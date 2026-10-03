import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyFirebaseToken } from './config/firebase';
import { prisma } from './config/prisma';
import jwt from 'jsonwebtoken';
import { activeProjectId } from './middleware/auth';
import { SocketEvents } from '@hospital-erp/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Track which users are viewing which pages
const presenceMap = new Map<string, Map<string, { userId: string; userName: string; userRole: string; page: string; timestamp: number }>>();
// presenceMap: projectId -> (socketId -> presence info)

export let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      // The Capacitor iOS app serves the UI from https://localhost inside
      // WKWebView — allow it alongside the web frontend origin.
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'https://localhost',
        'capacitor://localhost',
        'http://localhost',
      ],
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string;

      if (!token) {
        return next(new Error('No token provided'));
      }

      // The web/iOS app stores the app JWT issued at PIN login (it carries the
      // project chosen on the login page); fall back to a Firebase ID token.
      let claimedProjectId: string | undefined;
      let user = null;
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; projectId?: string };
        claimedProjectId = decoded.projectId;
        user = await prisma.user.findUnique({ where: { id: decoded.userId } });
      } catch {
        const decodedToken = await verifyFirebaseToken(token);
        user = await prisma.user.findFirst({
          where: {
            OR: [{ firebaseUid: decodedToken.uid }, { phone: decodedToken.phone_number }],
          },
        });
      }

      if (!user || !user.isActive) {
        return next(new Error('Unauthorized'));
      }

      socket.data.user = {
        id: user.id,
        role: user.role,
        projectId: await activeProjectId(claimedProjectId, user.projectId),
      };

      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    if (user?.projectId) {
      socket.join(`project:${user.projectId}`);
    }
    // Personal room: direct messages and groups are delivered per user.
    if (user?.id) {
      socket.join(`user:${user.id}`);
    }

    // Chat: the conversation on screen. Only used to skip push notifications for
    // a chat the user is already looking at, so a membership check is enough.
    socket.on(SocketEvents.CHAT_OPEN, async (data: { conversationId?: string }) => {
      try {
        const id = data?.conversationId;
        if (!id || !user?.projectId || typeof id !== 'string') return;
        const conversation = await prisma.chatConversation.findFirst({
          where: {
            id,
            projectId: user.projectId,
            OR: [{ type: 'GENERAL' }, { members: { some: { userId: user.id } } }],
          },
          select: { id: true },
        });
        if (conversation) socket.join(`chat:${id}`);
      } catch {
        /* best-effort */
      }
    });
    socket.on(SocketEvents.CHAT_CLOSE, (data: { conversationId?: string }) => {
      if (data?.conversationId) socket.leave(`chat:${data.conversationId}`);
    });

    // Presence: user is viewing a page
    socket.on('presence:join', (data: { page: string; userName: string; userRole: string }) => {
      if (!user?.projectId || !user?.id) return;
      const projectId = user.projectId;
      if (!presenceMap.has(projectId)) presenceMap.set(projectId, new Map());
      presenceMap.get(projectId)!.set(socket.id, {
        userId: user.id,
        userName: data.userName,
        userRole: data.userRole,
        page: data.page,
        timestamp: Date.now(),
      });
      // Broadcast presence update to all users in the project
      const viewers = Array.from(presenceMap.get(projectId)!.values());
      io?.to(`project:${projectId}`).emit('presence:update', { page: data.page, viewers });
    });

    // Presence: user left a page
    socket.on('presence:leave', (data: { page: string }) => {
      if (!user?.projectId) return;
      const projectId = user.projectId;
      presenceMap.get(projectId)?.delete(socket.id);
      const viewers = Array.from(presenceMap.get(projectId)?.values() ?? []);
      io?.to(`project:${projectId}`).emit('presence:update', { page: data.page, viewers });
    });

    socket.on('disconnect', () => {
      if (!user?.projectId) return;
      const projectId = user.projectId;
      const entry = presenceMap.get(projectId)?.get(socket.id);
      presenceMap.get(projectId)?.delete(socket.id);
      if (entry) {
        const viewers = Array.from(presenceMap.get(projectId)?.values() ?? []);
        io?.to(`project:${projectId}`).emit('presence:update', { page: entry.page, viewers });
      }
    });
  });

  return io;
}

export function emitToProject(projectId: string, event: string, data: unknown): void {
  if (io) {
    io.to(`project:${projectId}`).emit(event, data);
  }
}

export function emitToUsers(userIds: string[], event: string, data: unknown): void {
  if (io && userIds.length > 0) {
    io.to(userIds.map((id) => `user:${id}`)).emit(event, data);
  }
}

/** Users with a live socket currently viewing the given chat conversation. */
export async function userIdsViewingChat(conversationId: string): Promise<Set<string>> {
  if (!io) return new Set();
  const sockets = await io.in(`chat:${conversationId}`).fetchSockets();
  return new Set(sockets.map((s) => s.data?.user?.id as string).filter(Boolean));
}
