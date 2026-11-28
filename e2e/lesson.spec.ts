import { expect, test, countRows, openTab, register, seedDueCards, watchErrors } from './helpers';

test('a paused lesson resumes with only the cards not rated yet, and its clock survives a sync', async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  await seedDueCards(page, 14);
  await openTab(page, 'من');
  await page.locator('main').getByText('جلسهٔ آموزشی', { exact: true }).first().tap();
  await page.getByRole('button', { name: /شروع و ثبت آموزش/ }).tap();
  await expect(page.getByText('واژهٔ ۱ از ۱۴')).toBeVisible();

  for (const answer of ['یادم نبود', 'خوب یادم بود', 'خوب یادم بود']) {
    await page.getByRole('button', { name: 'نمایش معنی' }).tap();
    await page.getByRole('button', { name: answer }).tap();
  }
  await expect.poll(() => countRows(page, 'studyHistory')).toBe(3);

  // The sync after the ratings must not set the clock back.
  const clock = page.getByText(/ \/ ۳۰ دقیقه$/);
  const before = await clock.innerText();
  await page.waitForTimeout(4000);
  expect(await clock.innerText()).not.toBe(before);
  const seconds = (t: string) => { const [m, s] = t.split(' ')[0].replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split(':').map(Number); return m * 60 + s; };
  expect(seconds(await clock.innerText())).toBeGreaterThanOrEqual(seconds(before) + 3);

  await page.getByRole('button', { name: 'ذخیره و مکث' }).tap();
  await page.getByText(/ادامهٔ جلسه/).first().tap();
  await expect(page.getByText('واژهٔ ۱ از ۱۱')).toBeVisible();
  expect(await countRows(page, 'studyHistory')).toBe(3);
  expect(errors).toEqual([]);
});
