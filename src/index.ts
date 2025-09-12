import express from "express";
import cors from "cors";
import { assertRequiredEnv, config as appConfig } from "./config/env.js";
import { connectDB } from "./config/db.js";
import coloringBookRoutes from "./routes/coloringBook.routes.js";
import storybookRoutes from './routes/storybook.routes.js';
import poemsRoutes from './routes/poems.routes.js';
import authRoutes from './routes/auth.routes.js';
import revenuecatRoutes from './routes/revenuecat.routes.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { UPLOADS_DIR } from './utils/paths.js';

const app = express();
const PORT = appConfig.PORT;

// Global middleware
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// Health check / root route
app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "picstory-server",
    mode: appConfig.NODE_ENV,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use("/api/coloring-book", coloringBookRoutes);
app.use('/api/storybook', storybookRoutes);
app.use('/api/poems', poemsRoutes);
app.use('/api/revenuecat', revenuecatRoutes);

// Static site at /app
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
app.use('/app', express.static(publicDir));
app.get('/app', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Serve generated assets (images, PDFs) under /uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// 404 handler (after routes)
app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

// Error handler (last)
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
);

async function bootstrap() {
  assertRequiredEnv();
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
