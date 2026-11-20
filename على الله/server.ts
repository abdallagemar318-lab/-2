import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db.ts';
import { createAdminRouter } from './server/routes/admin.ts';
import { createAuthRouter } from './server/routes/auth.ts';
import { createStudentRouter } from './server/routes/student.ts';

async function startServer() {
  const db = getDb();
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16mb' }));

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/admin', createAdminRouter(db));
  app.use('/api/student', createStudentRouter(db));

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'نقطة النهاية المطلوبة غير موجودة.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('لم يتم بناء الواجهة الأمامية بعد.');
      }
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Bayan Arabic Educational Platform running on port ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
