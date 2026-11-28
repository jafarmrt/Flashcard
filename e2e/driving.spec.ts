import { expect, openTab, register, test, watchErrors } from './helpers';

const SENTENCES = [
  'The old harbor was quiet at dusk.',
  'A small boat drifted past the beacon.',
  'The sailors watched the water shiver under the wind.',
  'Nobody spoke for a long time.',
  'Then the bell rang twice.',
];

test('driving mode reads the book sentence by sentence, pauses and resumes at the same sentence, and keeps the spot', async ({ page }) => {
  // The device's speech is replaced: each sentence "takes" 250 ms and is recorded.
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as any).__spoken = spoken;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fake = {
      speak(u: any) { spoken.push(u.text); timer = setTimeout(() => u.onend?.(), 250); },
      cancel() { if (timer) clearTimeout(timer); },
      pause() {}, resume() {}, getVoices() { return []; },
      speaking: false, pending: false, paused: false,
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  });
  const errors = watchErrors(page);
  const spoken = () => page.evaluate(() => [...(window as any).__spoken] as string[]);

  await register(page);
  await openTab(page, 'کتابخانه');
  await page.getByPlaceholder('مثلاً فصل اول کتاب').fill('Drive story');
  await page.getByPlaceholder('Paste an English text here…').fill(SENTENCES.join(' '));
  await page.getByRole('button', { name: 'ساختن مسیر' }).tap();
  await expect(page.getByRole('button', { name: 'شروع بخش ۱' })).toBeVisible();

  await openTab(page, 'من');
  await page.locator('main').getByText('حالت رانندگی', { exact: true }).first().tap();
  await page.getByRole('button', { name: /شروع شنیدن/ }).tap();

  await expect.poll(async () => (await spoken()).length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'مکث' }).tap();
  const atPause = (await spoken()).length;
  await page.waitForTimeout(800);
  expect((await spoken()).length, 'nothing more is read while paused').toBe(atPause);

  await page.getByRole('button', { name: 'ادامه' }).tap();
  await expect.poll(async () => (await spoken()).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(atPause + 1);
  const afterResume = await spoken();
  expect(afterResume[atPause], 'resumes with the sentence that was cut off').toBe(afterResume[atPause - 1]);

  // Played to the end, in order.
  await expect.poll(async () => (await spoken()).at(-1), { timeout: 10_000 }).toBe(SENTENCES.at(-1));
  const order = (await spoken()).filter((t, i, all) => t !== all[i - 1]);
  expect(order).toEqual(SENTENCES);

  // Stopping keeps where listening stopped, on the book itself.
  await page.getByRole('button', { name: 'پایان حالت رانندگی' }).tap();
  await expect.poll(() => page.evaluate(() => new Promise<any>(resolve => {
    const open = indexedDB.open('LinguaCardsDB');
    open.onsuccess = () => {
      const req = open.result.transaction('sources').objectStore('sources').getAll();
      req.onsuccess = () => resolve(req.result[0]?.audioPosition?.chapterId ? 'saved' : 'missing');
    };
  }))).toBe('saved');
  expect(errors).toEqual([]);
});
