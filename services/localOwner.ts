// Whose data this browser's database holds. Cards made before signing in
// belong to nobody and go into the first account that signs in; data of one
// account is never taken into another (it would be uploaded there).

export const OWNER_KEY = 'owner';

// The account recorded as the owner, else the one the data last synced with
// (browsers from before the owner was recorded). None: made before signing in.
export const localOwner = (owner: unknown, syncState?: { user?: unknown } | null): string | undefined => {
  if (typeof owner === 'string' && owner) return owner;
  const user = syncState?.user;
  return typeof user === 'string' && user ? user : undefined;
};

export const belongsToAnother = (owner: string | undefined, username: string): boolean =>
  !!owner && owner.toLowerCase() !== username.toLowerCase();
