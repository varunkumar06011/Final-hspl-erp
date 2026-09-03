import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyFirebaseToken } from './config/firebase';
import { prisma } from './config/prisma';

// Track which users are viewing which pages
const presenceMap = new Map<string, Map<string, { userId: string; userName: string; userRole: string; page: string; timestamp: number }>>();
// presenceMap: projectId -> (socketId -> presence info)

export let io: SocketServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string;

      if (!token) {
        return next(new Error('No token provided'));
      }

      const decodedToken = await verifyFirebaseToken(token);

      const user = await prisma.user.findFirst({
        where: {
          OR: [{ firebaseUid: decodedToken.uid }, { phone: decodedToken.phone_number }],
        },
      });

      if (!user || !user.isActive) {
        return next(new Error('Unauthorized'));
      }

      socket.data.user = {
        id: user.id,
        role: user.role,
        projectId: user.projectId,
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
