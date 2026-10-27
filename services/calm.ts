// File: /services/calm.ts
// Calm mode, the default: the app is a way to read books, and progress is
// shown as what was read and learned. Points, levels, streaks and their
// shields, combos, badges, confetti and reward chests appear only when the
// user turns them on (Settings › playful). Nothing is deleted: points and
// badges are still counted, so turning them on shows them as they would be.

import type { Settings } from '../types';

export const isPlayful = (settings?: Pick<Settings, 'playful'> | null): boolean => settings?.playful === true;
