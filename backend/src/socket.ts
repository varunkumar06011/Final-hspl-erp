import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyFirebaseToken } from './config/firebase';
import { prisma } from './config/prisma';

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

    socket.on('disconnect', () => {
      // Client disconnected
    });
  });

  return io;
}

export function emitToProject(projectId: string, event: string, data: unknown): void {
  if (io) {
    io.to(`project:${projectId}`).emit(event, data);
  }
}
