// Vercel serverless function for /api/proxy. All the logic lives in
// server/api.ts and is shared with the Express server (server.ts), so the two
// deployments always behave the same.
// On Vercel set SESSION_SECRET and connect Upstash Redis (KV_REST_API_URL,
// KV_REST_API_TOKEN); the function's disk is not kept between requests.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleProxy } from '../server/api.js';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }
  return handleProxy(request, response);
}
