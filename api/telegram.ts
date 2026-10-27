// Vercel serverless function for /api/telegram: the bot's webhook (POST from
// Telegram) and the daily cron (GET, see vercel.json). The logic is in
// server/api.ts and server/telegram.ts, shared with the Express server.
// On Vercel set TELEGRAM_BOT_TOKEN (from @BotFather) and CRON_SECRET.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleTelegram } from '../server/api.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }
  return handleTelegram(request, response);
}
