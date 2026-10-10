import Dexie from 'dexie';

// While the app is being built, a change that old data in a browser could
// break bumps DATA_EPOCH: each browser then deletes its own database once and
// takes everything again from the server at the next sync. Settings and the
// sign-in stay. If the delete cannot run (another tab holds the database),
// it is tried again at the next start.
export const DATA_EPOCH = '2026-10-10';
const EPOCH_KEY = 'dataEpoch';

const readEpoch = (): string | null => {
  try { return localStorage.getItem(EPOCH_KEY); } catch { return null; }
};

export const startFresh = async (
  deleteDb: () => Promise<void> = () => Dexie.delete('LinguaCardsDB'),
  timeoutMs = 4000,
): Promise<boolean> => {
  if (readEpoch() === DATA_EPOCH) return false;
  try {
    await Promise.race([
      deleteDb(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs)),
    ]);
    localStorage.setItem(EPOCH_KEY, DATA_EPOCH);
    return true;
  } catch (e) {
    console.warn('Could not start this browser afresh, will try again next time:', e);
    return false;
  }
};
