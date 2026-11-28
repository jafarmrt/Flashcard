import { devices, type Page } from '@playwright/test';
import { expect, fakeOutsideServices, register, seedDueCards, signIn, test, watchErrors } from './helpers';

const cardOn = (page: Page, id: string) => page.evaluate(cardId => new Promise<any>(resolve => {
  const open = indexedDB.open('LinguaCardsDB');
  open.onsuccess = () => {
    const req = open.result.transaction('flashcards').objectStore('flashcards').get(cardId);
    req.onsuccess = () => resolve(req.result || null);
  };
}), id);

test('two devices on one account: cards and a review made on one reach the other', async ({ browser }) => {
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const tablet = await browser.newContext({ ...devices['iPhone 13'] });
  await fakeOutsideServices(phone);
  await fakeOutsideServices(tablet);
  const a = await phone.newPage();
  const b = await tablet.newPage();
  const errorsA = watchErrors(a);
  const errorsB = watchErrors(b);

  const name = await register(a);
  await seedDueCards(a, 2);
  await signIn(b, name);
  await expect.poll(async () => (await cardOn(b, 'e2e-card-0'))?.front).toBe('harbor');

  // One card reviewed on the phone, which then goes to the background in
  // the middle of the session (the user locks it); the tablet gets the new
  // schedule on its next sync.
  await a.getByRole('button', { name: /شروع مرور/ }).tap();
  await a.getByRole('button', { name: /نمایش پاسخ/ }).tap();
  await a.getByRole('button', { name: /^خوب/ }).tap();
  await expect(a.getByText(/^۲ از ۲$/)).toBeVisible();
  await a.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  let reviewed: any = null;
  await expect.poll(async () => {
    const cards = [await cardOn(a, 'e2e-card-0'), await cardOn(a, 'e2e-card-1')];
    reviewed = cards.find(c => c && c.dueDate > new Date().toISOString());
    return !!reviewed;
  }).toBe(true);

  // The tablet is opened again (it syncs a moment after it starts).
  await b.reload();
  await expect.poll(async () => (await cardOn(b, reviewed.id))?.dueDate, { timeout: 20_000 }).toBe(reviewed.dueDate);

  expect([...errorsA, ...errorsB]).toEqual([]);
  await phone.close();
  await tablet.close();
});
