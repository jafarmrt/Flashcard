export const AUTH_REQUIRED_EVENT = 'lingua-auth-required';

// A failed proxy call, with the HTTP status so callers can tell a wrong key
// (no point retrying) from a timeout or a busy provider.
export class ProxyError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
  }
}

export type ProxyAction =
  | 'auth-register' | 'auth-login' | 'auth-session' | 'auth-logout'
  | 'sync' | 'keys-sync' | 'chapter-put' | 'chapter-get' | 'fetch-page' | 'storage-usage'
  | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'test-ai-key' | 'list-models'
  | 'dictionary-lookup' | 'test-dictionary' | 'fetch-audio' | 'word-frequencies' | 'free-enrich' | 'free-translate' | 'ai-speech' | 'list-speech-models'
  | 'telegram-status' | 'telegram-link' | 'telegram-update' | 'telegram-send' | 'telegram-unlink';

// The status a request that took too long fails with. Not a "permanent"
// status, so the AI chain goes on to the next service.
export const TIMEOUT_STATUS = 408;

// Without a limit a request on a dead connection (a phone between networks,
// a server that never answers) waited for ever and the screen with it.
// Requests that wait for an AI or a big upload may take up to the server's
// own limit (60 s on Vercel); everything else should answer quickly.
const SLOW_ACTIONS = new Set<ProxyAction>(['gemini-generate', 'ai-speech', 'test-ai-key', 'sync', 'chapter-put', 'chapter-get', 'fetch-page', 'free-enrich', 'free-translate', 'word-frequencies']);
export const SLOW_TIMEOUT_MS = 70_000;
export const DEFAULT_TIMEOUT_MS = 25_000;
export const timeoutFor = (action: ProxyAction): number => (SLOW_ACTIONS.has(action) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

export interface ProxyOptions {
  timeoutMs?: number;
  signal?: AbortSignal; // the caller's own cancel; it rejects with the AbortError, not a ProxyError
}

// A helper function to call our secure proxy
export const callProxy = async (action: ProxyAction, payload: object, options: ProxyOptions = {}) => {
  const timeoutMs = options.timeoutMs ?? timeoutFor(action);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onCancel);
  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401 && errorData.code === 'AUTH_REQUIRED' && typeof window !== 'undefined') {
        // The session cookie is missing or expired: let the app show the sign-in screen.
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      }
      throw new ProxyError(errorData.error || `Request failed (${response.status})`, response.status);
    }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new ProxyError(`No answer from the server in ${Math.round(timeoutMs / 1000)} s.`, TIMEOUT_STATUS);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCancel);
  }
};
