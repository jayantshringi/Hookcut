import { startBridgeServer } from '../vercel-bridge/server.mjs';

startBridgeServer({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
});
