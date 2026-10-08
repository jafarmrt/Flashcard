import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIncomingSettings, newerSettings, toSyncedSettings } from '../services/settingsSync';

test('the AI key never leaves the device', () => {
  const synced = toSyncedSettings({ dailyReviewGoal: 40, customApiKey: 'secret' });
  assert.deepEqual(synced, { dailyReviewGoal: 40 });
});

test('the most recently changed settings win on the server', () => {
  const phone = { dailyReviewGoal: 30, updatedAt: '2026-10-08T10:00:00Z' };
  const laptop = { dailyReviewGoal: 50, updatedAt: '2026-10-08T12:00:00Z', customApiKey: 'k' };
  assert.deepEqual(newerSettings(phone, laptop), { dailyReviewGoal: 50, updatedAt: '2026-10-08T12:00:00Z' });
  assert.deepEqual(newerSettings(laptop, phone), { dailyReviewGoal: 50, updatedAt: '2026-10-08T12:00:00Z' });
  assert.deepEqual(newerSettings(undefined, phone), phone);
  assert.equal(newerSettings(undefined, undefined), undefined);
});

test('newer settings from the cloud are adopted but keep the local AI key', () => {
  const local = { dailyReviewGoal: 20, customApiKey: 'mine', updatedAt: '2026-10-08T09:00:00Z' };
  const cloud = { dailyReviewGoal: 60, theme: 'dark' as const, updatedAt: '2026-10-08T11:00:00Z' };
  assert.deepEqual(applyIncomingSettings(local, cloud), {
    dailyReviewGoal: 60, theme: 'dark', customApiKey: 'mine', updatedAt: '2026-10-08T11:00:00Z',
  });
});

test('older or unstamped cloud settings leave the device alone', () => {
  const local = { dailyReviewGoal: 20, updatedAt: '2026-10-08T11:00:00Z' };
  assert.equal(applyIncomingSettings(local, { dailyReviewGoal: 60, updatedAt: '2026-10-08T09:00:00Z' }), null);
  assert.equal(applyIncomingSettings(local, { dailyReviewGoal: 60 }), null);
  assert.equal(applyIncomingSettings(local, undefined), null);
});

test('a device that never saved settings takes the cloud ones', () => {
  assert.deepEqual(applyIncomingSettings({}, { dailyReviewGoal: 60, updatedAt: '2026-10-08T09:00:00Z' }),
    { dailyReviewGoal: 60, updatedAt: '2026-10-08T09:00:00Z' });
});
