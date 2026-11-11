// Load environment variables BEFORE importing `app`, so startup config validation sees `.env` values
import 'dotenv/config';
import { app } from './app';

const PORT = process.env.PORT || 4000;

// Start HTTP server; separated from `app.ts` so Supertest can test `app` without binding a real port
app.listen(PORT, () => {
  console.log(`🚀 CodeCollab API server running at http://localhost:${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
});