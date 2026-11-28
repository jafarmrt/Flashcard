import { expect, test, countRows, openTab, register, seedDueCards, watchErrors } from './helpers';

const answer = async (page: import('@playwright/test').Page, rating: RegExp) => {
  await page.getByRole('button', { name: /نمایش پاسخ/ }).tap();
  await page.getByRole('button', { name: rating }).tap();
};

test('a lesson reviews with the app\'s own review, resumes with only the cards not rated yet, and moves on to its quiz', async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  await seedDueCards(page, 14);
  await openTab(page, 'من');
  await page.locator('main').getByText('جلسهٔ آموزشی', { exact: true }).first().tap();
  await page.getByRole('button', { name: /شروع و ثبت آموزش/ }).tap();
  await expect(page.getByText(/^۱ از ۱۴$/)).toBeVisible();

  // "Again" brings a card back later in the same session (the review's rule).
  await answer(page, /^دوباره/);
  await expect(page.getByText(/^۲ از ۱۵$/)).toBeVisible();
  await answer(page, /^خوب/);
  await answer(page, /^خوب/);
  await expect.poll(() => countRows(page, 'studyHistory')).toBe(3);

  // The sync after the ratings must not set the lesson's clock back.
  const clock = page.getByText(/ \/ ۳۰ دقیقه$/);
  const before = await clock.innerText();
  await page.waitForTimeout(4000);
  const seconds = (t: string) => { const [m, s] = t.split(' ')[0].replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split(':').map(Number); return m * 60 + s; };
  expect(seconds(await clock.innerText())).toBeGreaterThanOrEqual(seconds(before) + 3);

  await page.getByRole('button', { name: 'ذخیره و مکث' }).tap();
  await page.getByText(/ادامهٔ جلسه/).first().tap();
  await expect(page.getByText(/^۱ از ۱۱$/)).toBeVisible();
  expect(await countRows(page, 'studyHistory')).toBe(3);

  // The other eleven, then the lesson goes on to its quiz.
  for (let i = 0; i < 11; i++) await answer(page, /^خوب/);
  await expect(page.getByText('مرور تمام شد')).toBeVisible();
  await page.getByRole('button', { name: 'ادامهٔ جلسه' }).tap();
  await expect(page.getByText(/آزمون چهارگزینه‌ای جلسه/).first()).toBeVisible();
  expect(await countRows(page, 'studyHistory')).toBe(14);
  expect(errors).toEqual([]);
});
