import { expect, test, openTab, register, signIn, watchErrors } from './helpers';

test('a new account opens on Today, and signing in again works', async ({ page }) => {
  const errors = watchErrors(page);
  const name = await register(page);
  for (const tab of ['کتابخانه', 'واژه‌ها', 'من', 'امروز'] as const) {
    await openTab(page, tab);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.context().clearCookies();
  await signIn(page, name);
  expect(errors).toEqual([]);
});
