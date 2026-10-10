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
  | 'sync' | 'chapter-put' | 'chapter-get' | 'fetch-page' | 'storage-usage'
  | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'test-ai-key'
  | 'dictionary-lookup' | 'test-dictionary' | 'fetch-audio' | 'word-frequencies' | 'free-enrich' | 'free-translate';

// A helper function to call our secure proxy
export const callProxy = async (action: ProxyAction, payload: object) => {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401 && errorData.code === 'AUTH_REQUIRED') {
        // The session cookie is missing or expired: let the app show the sign-in screen.
        window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      }
      throw new ProxyError(errorData.error || `Request failed (${response.status})`, response.status);
    }
    return response.json();
};
