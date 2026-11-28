import { expect, openTab, register, test } from './helpers';

test('an error the app reports is kept on the device and can be copied as a report', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await register(page);
  // As the app does when something fails, and an error nobody caught.
  await page.evaluate(() => {
    console.error('Sync failed:', new TypeError('e2e: Failed to fetch'));
    setTimeout(() => { throw new Error('e2e: uncaught'); }, 0);
  });
  await page.waitForTimeout(200);
  await page.reload(); // kept across a reload
  await expect(page.getByText(/سلام/)).toBeVisible();

  await openTab(page, 'من');
  await page.locator('main').getByText('وضعیت و عیب‌یابی', { exact: true }).first().tap();
  const log = page.locator('section', { has: page.getByRole('heading', { name: 'گزارش خطاهای برنامه' }) });
  await expect(log.getByText('Sync failed: TypeError: e2e: Failed to fetch')).toBeVisible();
  await expect(log.getByText('Error: e2e: uncaught')).toBeVisible();

  await log.getByRole('button', { name: 'کپی گزارش برای ارسال' }).tap();
  await expect(log.getByText('گزارش کپی شد؛ در پیامت بچسبانش.')).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toMatch(/^Lingua Cards \d+\.\d+\.\d+/);
  expect(report).toContain('Sync failed: TypeError: e2e: Failed to fetch');

  await log.getByRole('button', { name: 'پاک کردن فهرست' }).tap();
  await expect(log.getByText('خطایی ثبت نشده است.')).toBeVisible();
});
