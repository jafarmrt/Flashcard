// A helper function to call our secure proxy
export const callProxy = async (action: 'auth-register' | 'auth-login' | 'sync-load' | 'sync-merge' | 'ping' | 'ping-free-dict' | 'ping-mw' | 'gemini-generate' | 'dictionary-free' | 'dictionary-mw', payload: object) => {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Request failed');
    }
    return response.json();
};
