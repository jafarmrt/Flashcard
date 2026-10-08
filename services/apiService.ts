export const AUTH_REQUIRED_EVENT = 'lingua-auth-required';

// A helper function to call our secure proxy
export const callProxy = async (action: 'auth-register' | 'auth-login' | 'auth-session' | 'auth-logout' | 'sync-load' | 'sync-merge' | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'test-ai-key' | 'dictionary-free' | 'dictionary-mw' | 'fetch-audio', payload: object) => {
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
      throw new Error(errorData.error || 'Request failed');
    }
    return response.json();
};
