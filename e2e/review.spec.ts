import { expect, test, countRows, register, seedDueCards, watchErrors } from './helpers';

test('a review of due cards rates each card once and ends', async ({ page }) => {
  const errors = watchErrors(page);
  await register(page);
  await seedDueCards(page, 4);
  await page.getByRole('button', { name: /شروع مرور/ }).tap();

  for (let i = 1; i <= 4; i++) {
    await expect(page.getByText(new RegExp(`^${'۱۲۳۴'[i - 1]} از ۴$`))).toBeVisible();
    await page.getByRole('button', { name: /نمایش پاسخ/ }).tap();
    await page.getByRole('button', { name: /^خوب/ }).tap();
  }
  await expect(page.getByText('مرور تمام شد')).toBeVisible();
  await expect.poll(() => countRows(page, 'studyHistory')).toBe(4);
  expect(errors).toEqual([]);
});
