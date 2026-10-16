// CHANGELOG.md is the one place a version is written. The app's version, the
// changes page and the "new version" notice are all read from it, and a test
// keeps package.json on the same version.
//
// A release starts with "## [x.y.z] - YYYY-MM-DD - Title" (the date may be
// left out in old entries) and lists its changes as "- **Label:** text".

export interface ChangelogItem {
  label: string;
  text: string;
}

export interface Release {
  version: string;
  date?: string;
  title: string;
  items: ChangelogItem[];
}

const HEADING = /^##\s+\[(\d+\.\d+\.\d+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2})\s*)?(?:-\s*(.*))?$/;
const ITEM = /^[-*]\s+(?:\*\*(.+?):?\*\*:?\s*)?(.*)$/;

export const parseChangelog = (text: string): Release[] => {
  const releases: Release[] = [];
  let current: Release | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line.trim());
    if (heading) {
      current = { version: heading[1], title: (heading[3] || '').trim(), items: [] };
      if (heading[2]) current.date = heading[2];
      releases.push(current);
      continue;
    }
    if (!current) continue;
    const item = /^\s{0,1}[-*]\s/.test(line) ? ITEM.exec(line.trim()) : null;
    if (item) {
      current.items.push({ label: (item[1] || '').trim(), text: item[2].trim() });
    } else if (line.trim() && current.items.length) {
      // A nested point or a wrapped line belongs to the item above it.
      const last = current.items[current.items.length - 1];
      last.text = `${last.text} ${line.trim().replace(/^[-*]\s+/, '• ')}`;
    }
  }
  return releases;
};

const parts = (v: string) => v.split('.').map(n => parseInt(n, 10) || 0);

export const compareVersions = (a: string, b: string): number => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

export const latestVersion = (releases: Release[]): string => releases[0]?.version || '0.0.0';

// The releases a returning user has not seen yet, newest first. Nothing for
// a first visit (no version seen), so a new user is not shown the history.
export const unseenReleases = (releases: Release[], seen: string | null | undefined): Release[] =>
  seen ? releases.filter(r => compareVersions(r.version, seen) > 0) : [];
