// Shared steps for the end-to-end checks.
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'long-enough-password-1';

// A name no earlier run used: the data folder is kept between runs.
export const newUsername = () => `e2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function register(page: Page, username = newUsername()): Promise<string> {
  await page.goto('/');
  await page.getByText('حساب نداری؟ ساخت حساب تازه').tap();
  await page.fill('input[placeholder="username"]', username);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: 'ساخت حساب', exact: true }).tap();
  await expect(page.getByText(`سلام ${username}`)).toBeVisible();
  return username;
}

export async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/');
  await page.fill('input[placeholder="username"]', username);
  await page.fill('input[type="password"]', PASSWORD);
  await page.getByRole('button', { name: 'ورود به حساب', exact: true }).tap();
  await expect(page.getByText(`سلام ${username}`)).toBeVisible();
}

export const WORDS = ['harbor', 'beacon', 'glimpse', 'shiver', 'meadow', 'linger', 'wander', 'vivid', 'fragile', 'hollow', 'murmur', 'gleam', 'dusk', 'thrive'];

// Puts due cards into the signed-in account through the server, as another
// device would, then reloads so this page pulls them.
export async function seedDueCards(page: Page, count: number): Promise<void> {
  const status = await page.evaluate(async (words: string[]) => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const cards = words.map((w, i) => ({
      id: `e2e-card-${i}`, deckId: 'e2e-deck', front: w, back: `معنی ${i}`, sourceSentence: `They saw the ${w} at once.`,
      createdAt: past, updatedAt: now, repetition: 1, easinessFactor: 2.5, interval: 2, stability: 2, dueDate: past,
    }));
    const decks = [{ id: 'e2e-deck', name: 'E2E', createdAt: past, updatedAt: now }];
    const res = await fetch('/api/proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', since: 0, changes: { decks, cards } }),
    });
    return res.status;
  }, WORDS.slice(0, count));
  expect(status).toBe(200);
  await page.reload();
  await expect(page.getByText(/سلام/)).toBeVisible();
}

// Rows in one of the app's IndexedDB tables on this page.
export const countRows = (page: Page, table: string): Promise<number> =>
  page.evaluate(name => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('LinguaCardsDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction(name).objectStore(name).count();
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    };
  }), table);

// Console errors and uncaught exceptions on a page; a test ends by checking
// it is empty. The test server has no AI key, so the app's own report of
// that (and the 400 behind it) is expected and left out.
const NO_AI_KEY = /no API key|status of 400 \(Bad Request\)/;
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !NO_AI_KEY.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return errors;
}

export async function openTab(page: Page, label: 'امروز' | 'کتابخانه' | 'واژه‌ها' | 'من'): Promise<void> {
  await page.locator('nav').last().getByText(label, { exact: true }).tap();
}
