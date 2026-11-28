import { test, expect, type Page } from '@playwright/test';
import { countRows, openTab, register, watchErrors } from './helpers';

const TEXT = 'The old harbor was quiet at dusk. A small boat drifted past the beacon, and the sailors watched the water shiver under the wind.';

// The dictionaries are outside services: their answer is made up here, so
// the check runs without the internet and always sees the same meaning.
async function fakeDictionaries(page: Page) {
  await page.route('**/api/proxy', async route => {
    const body = route.request().postDataJSON() || {};
    if (body.action === 'dictionary-lookup' || body.action === 'free-enrich') {
      return route.fulfill({ json: {
        found: true, headword: body.word || body.term, pronunciation: '/ˈhɑːrbər/', partOfSpeech: 'noun',
        definitions: ['a place where boats stay'], examples: [], translation: 'بندر', collocations: [],
      } });
    }
    if (body.action === 'free-translate') return route.fulfill({ json: { translation: 'بندر' } });
    return route.continue();
  });
}

test('a pasted text is read, a tapped word becomes a card with its sentence, and the section is finished', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeDictionaries(page);
  await register(page);
  const cardsBefore = await countRows(page, 'flashcards');

  await openTab(page, 'کتابخانه');
  await page.getByPlaceholder('مثلاً فصل اول کتاب').fill('E2E story');
  await page.getByPlaceholder('Paste an English text here…').fill(TEXT);
  await page.getByRole('button', { name: 'ساختن مسیر' }).tap();
  await page.getByRole('button', { name: 'شروع بخش ۱' }).tap();

  await page.getByRole('button', { name: 'harbor', exact: true }).tap();
  const sheet = page.getByRole('region', { name: 'جزئیات واژه' });
  await expect(sheet.getByText('بندر')).toBeVisible();
  await sheet.getByRole('button', { name: '+ کارت' }).tap();
  await expect.poll(() => countRows(page, 'flashcards')).toBe(cardsBefore + 1);
  const card = await page.evaluate(() => new Promise<any>(resolve => {
    const open = indexedDB.open('LinguaCardsDB');
    open.onsuccess = () => {
      const req = open.result.transaction('flashcards').objectStore('flashcards').getAll();
      req.onsuccess = () => resolve(req.result.find((c: any) => c.front === 'harbor'));
    };
  }));
  expect(card?.back).toContain('بندر');
  expect(card?.sourceSentence).toContain('The old harbor was quiet at dusk.');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /پایان این بخش/ }).tap();
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => {
    const open = indexedDB.open('LinguaCardsDB');
    open.onsuccess = () => {
      const req = open.result.transaction('chapters').objectStore('chapters').getAll();
      req.onsuccess = () => resolve(req.result.reduce((n: number, c: any) => n + (c.completed?.length || 0), 0));
    };
  }))).toBe(1);
  expect(errors).toEqual([]);
});
