// Load environment variables BEFORE importing `app`, so startup config validation sees `.env` values
import 'dotenv/config';
import http from 'node:http';
import { prisma } from '@codecollab/database';
import { app } from './app';
import { redis } from './lib/redis';
import { createRealtimeServer } from './realtime/socketServer';
import { yjsRoomManager } from './realtime/yjsRoomManager';

const PORT = process.env.PORT || 4000;

// Wrap Express inside a shared HTTP server so Socket.IO upgrades and REST share one port
const httpServer = http.createServer(app);
const io = createRealtimeServer(httpServer, yjsRoomManager);

httpServer.listen(PORT, () => {
  console.log(`🚀 CodeCollab API server running at http://localhost:${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
  console.log(`⚡ Real-time WebSocket gateway listening on ws://localhost:${PORT}`);
});

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${signal} received — flushing Yjs documents and closing connections...`);

  try {
    await io.close();
    await yjsRoomManager.closeAll();
    await prisma.$disconnect();
    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  } finally {
    httpServer.close(() => {
      process.exit(0);
    });
    // Force exit if lingering keep-alive sockets hold the process open
    setTimeout(() => process.exit(0), 3000).unref();
  }
};

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
