import type { Settings } from '../types';

// Settings travel with the account so every device shows the same daily goal,
// theme and AI choices. The keys go apart from them, encrypted on the server
// (services/keySync), never in the settings record.
const DEVICE_ONLY: (keyof Settings)[] = ['customApiKey', 'aiKeys', 'dictKeys', 'keysChanged'];

export function toSyncedSettings(settings: Partial<Settings> | null | undefined): Partial<Settings> | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const copy: Record<string, unknown> = { ...settings };
  for (const key of DEVICE_ONLY) delete copy[key];
  return copy as Partial<Settings>;
}

const changedAt = (s?: Partial<Settings>) => new Date(s?.updatedAt || 0).getTime() || 0;

// The settings changed most recently win; `a` wins a tie.
export function newerSettings(a?: Partial<Settings> | null, b?: Partial<Settings> | null): Partial<Settings> | undefined {
  const pick = a && b ? (changedAt(a) >= changedAt(b) ? a : b) : a || b;
  return toSyncedSettings(pick);
}

// Settings from the server replace this device's only when they are newer,
// and the device keeps its own secrets.
export function applyIncomingSettings(local: Partial<Settings>, incoming?: Partial<Settings> | null): Partial<Settings> | null {
  if (!incoming || !incoming.updatedAt || changedAt(incoming) <= changedAt(local)) return null;
  const merged: Partial<Settings> = { ...local, ...toSyncedSettings(incoming) };
  for (const key of DEVICE_ONLY) {
    if (local[key] === undefined) delete merged[key];
    else (merged as Record<string, unknown>)[key] = local[key];
  }
  return merged;
}
