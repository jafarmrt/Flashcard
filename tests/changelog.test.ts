import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareVersions, latestVersion, parseChangelog, unseenReleases } from '../services/changelog';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('a release is read with its date, title and labelled items', () => {
  const releases = parseChangelog([
    '# Changelog', 'intro', '',
    '## [2.1.0] - 2026-10-16 - Better Things',
    '- **Feature:** one',
    '  - nested point',
    '- plain item',
    '',
    '## [2.0.0] - Old Style Without a Date',
    '- **Fix:** two: with a colon',
  ].join('\n'));
  assert.deepEqual(releases, [
    { version: '2.1.0', date: '2026-10-16', title: 'Better Things', items: [{ label: 'Feature', text: 'one • nested point' }, { label: '', text: 'plain item' }] },
    { version: '2.0.0', title: 'Old Style Without a Date', items: [{ label: 'Fix', text: 'two: with a colon' }] },
  ]);
});

test('versions compare by number, and only newer releases are new to a returning user', () => {
  assert.ok(compareVersions('7.10.0', '7.9.1') > 0);
  assert.equal(compareVersions('7.4.0', '7.4.0'), 0);
  const releases = parseChangelog('## [7.4.0] - A\n- x\n## [7.3.0] - B\n- y\n## [7.2.0] - C\n- z');
  assert.deepEqual(unseenReleases(releases, '7.2.0').map(r => r.version), ['7.4.0', '7.3.0']);
  assert.deepEqual(unseenReleases(releases, '7.4.0'), []);
  assert.deepEqual(unseenReleases(releases, null), [], 'a first visit gets no notice');
});

test('CHANGELOG.md: newest first, each version once, dated from 5.3.0 on, and package.json on the newest', () => {
  const releases = parseChangelog(changelog);
  assert.ok(releases.length > 10);
  for (let i = 1; i < releases.length; i++) {
    assert.ok(compareVersions(releases[i - 1].version, releases[i].version) > 0, `${releases[i - 1].version} must be newer than ${releases[i].version}`);
  }
  for (const r of releases.filter(r => compareVersions(r.version, '5.3.0') >= 0)) {
    assert.match(r.date || '', /^\d{4}-\d{2}-\d{2}$/, `${r.version} needs a date`);
    assert.ok(r.title, `${r.version} needs a title`);
    assert.ok(r.items.length > 0, `${r.version} needs its changes`);
  }
  for (let i = 1; i < releases.length; i++) {
    if (releases[i - 1].date && releases[i].date) assert.ok(releases[i - 1].date! >= releases[i].date!, `${releases[i - 1].version} is dated before ${releases[i].version}`);
  }
  assert.equal(pkg.version, latestVersion(releases), 'package.json "version" must be the newest release in CHANGELOG.md');
});
