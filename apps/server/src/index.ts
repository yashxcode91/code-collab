import 'dotenv/config';
import { app } from './app';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 CodeCollab API server running at http://localhost:${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/api/health`);
});