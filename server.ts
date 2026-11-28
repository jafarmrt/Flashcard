import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleProxy, handleTelegram, startTelegramWorker } from './server/api';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// PORT and HOST let the app share a server with other apps: on a VPS bind it
// to 127.0.0.1 on a free port and let nginx in front of it face the internet.
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// The app and its API share one origin, so no CORS headers are sent: other
// sites cannot call the API from a browser. Behind nginx, trust its
// X-Forwarded-* headers so req.secure and req.ip are right.
app.set('trust proxy', 'loopback');
// Vercel refuses bodies over 4.5 MB; a VPS takes a little more (a long
// chapter's text), not 50 MB that is parsed before anyone signs in.
app.use(express.json({ limit: '10mb' }));
// The same headers as vercel.json: no framing by other sites (clickjacking),
// no content-type guessing, no full URLs sent to other sites, and only
// the microphone among the device's sensors. (No full script CSP yet: the
// AI services, dictionaries and audio would need their own list.)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  next();
});

app.post('/api/proxy', (req, res) => handleProxy(req, res));
// Telegram's updates (webhook) and a cron, as on Vercel (api/telegram.ts).
app.all('/api/telegram', (req, res) => handleTelegram(req, res));
startTelegramWorker();


// Setup Vite dev server or static file serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    // Express 5 no longer accepts '*' as a path; a regex matches every route
    app.get(/.*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚀 Lingua Cards server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
