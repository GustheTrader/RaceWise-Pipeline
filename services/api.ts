const PASSWORD_KEY = 'racewise-app-password';

// Vercel rejects request bodies over 4.5 MB; base64 adds a third to the PDF's size.
export const MAX_PDF_BYTES = 3.2 * 1024 * 1024;

/** POSTs to one of the server routes in api/, asking for the app password the first time. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let password = localStorage.getItem(PASSWORD_KEY);
    if (!password || attempt > 0) {
      password = window.prompt(attempt > 0 ? 'Wrong password. RaceWise app password:' : 'RaceWise app password:');
      if (!password) throw new Error('App password required');
      localStorage.setItem(PASSWORD_KEY, password);
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-password': password },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      localStorage.removeItem(PASSWORD_KEY);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || (data.errors?.length ? data.errors.join('; ') : `HTTP ${res.status}`));
    }
    return data as T;
  }
  throw new Error('Wrong app password');
}
