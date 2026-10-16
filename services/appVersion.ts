// The app's version and release notes, read from CHANGELOG.md at build time.
import changelogText from '../CHANGELOG.md?raw';
import { latestVersion, parseChangelog } from './changelog';

export const RELEASES = parseChangelog(changelogText);
export const APP_VERSION = latestVersion(RELEASES);
