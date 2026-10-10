// File: /services/dictionaryCatalog.ts
// The dictionaries the app can ask, shared by the server (which asks them)
// and the settings page (which orders them and keeps their keys). Like the AI
// services, they are tried in the order the user chose; the first one that
// knows the term gives the meaning.

export type DictionaryId = 'free-dictionary' | 'wiktionary' | 'mw-learners' | 'mw-collegiate' | 'datamuse' | 'urban';

// Keys typed in the settings: the two Merriam-Webster dictionaries, and an
// email address that raises the daily MyMemory translation quota.
export type DictionaryKeyId = 'mw-learners' | 'mw-collegiate' | 'mymemory';

export interface DictionaryInfo {
  id: DictionaryId;
  name: string;
  hint: string; // what it is good for, in Persian
  needsKey: boolean;
  keyUrl?: string;
  enabledByDefault: boolean;
}

export const DICTIONARIES: DictionaryInfo[] = [
  { id: 'free-dictionary', name: 'Free Dictionary', hint: 'تلفظ، صدا و تعریف واژه‌های تکی؛ بدون کلید.', needsKey: false, enabledByDefault: true },
  { id: 'wiktionary', name: 'Wiktionary', hint: 'بیشترین پوشش برای فعل‌های عبارتی، ایدیوم‌ها، اصطلاح‌ها و اسلنگ؛ بدون کلید.', needsKey: false, enabledByDefault: true },
  { id: 'mw-learners', name: "Merriam-Webster Learner's", hint: 'دیکشنری زبان‌آموز با ایدیوم‌ها و فعل‌های عبارتی؛ کلید رایگان می‌خواهد.', needsKey: true, keyUrl: 'https://dictionaryapi.com/register/index', enabledByDefault: true },
  { id: 'mw-collegiate', name: 'Merriam-Webster Collegiate', hint: 'دیکشنری کامل آمریکایی؛ کلید رایگان می‌خواهد.', needsKey: true, keyUrl: 'https://dictionaryapi.com/register/index', enabledByDefault: true },
  { id: 'datamuse', name: 'Datamuse', hint: 'تعریف‌های کوتاه، وقتی بقیه چیزی پیدا نکنند؛ بدون کلید.', needsKey: false, enabledByDefault: true },
  { id: 'urban', name: 'Urban Dictionary', hint: 'فقط برای اسلنگ؛ نوشتهٔ کاربران است و فیلتر نمی‌شود.', needsKey: false, enabledByDefault: false },
];

export const DICTIONARY_IDS = DICTIONARIES.map(d => d.id);

export const dictionaryInfo = (id: DictionaryId): DictionaryInfo => DICTIONARIES.find(d => d.id === id) || DICTIONARIES[0];

export const DEFAULT_DICTIONARY_ORDER: DictionaryId[] = DICTIONARIES.filter(d => d.enabledByDefault).map(d => d.id);

// What a request carries: the dictionaries to try, in order, and the keys
// typed on this device. The server uses its own keys (MW_API_KEY…) when none
// is given.
export interface DictionaryRequest {
  order?: DictionaryId[];
  keys?: Partial<Record<DictionaryKeyId, string>>;
}

// A request as it arrived: only known ids, each once, and short string keys.
export const cleanDictionaryRequest = (value: unknown): DictionaryRequest => {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const order = Array.isArray(v.order)
    ? (v.order.filter((id, i, all) => DICTIONARY_IDS.includes(id as DictionaryId) && all.indexOf(id) === i) as DictionaryId[])
    : undefined;
  const keys: Partial<Record<DictionaryKeyId, string>> = {};
  const rawKeys = v.keys && typeof v.keys === 'object' ? (v.keys as Record<string, unknown>) : {};
  for (const id of ['mw-learners', 'mw-collegiate', 'mymemory'] as DictionaryKeyId[]) {
    const key = rawKeys[id];
    if (typeof key === 'string' && key.trim() && key.length <= 200) keys[id] = key.trim();
  }
  return { ...(order ? { order } : {}), keys };
};

// The dictionaries that can answer, in order ("free-dictionary,wiktionary,
// mw-learners+k"), so a saved lookup is only reused for the same choice.
export const dictionarySignature = (order: DictionaryId[], hasKey: (id: DictionaryId) => boolean): string =>
  order
    .filter(id => !dictionaryInfo(id).needsKey || hasKey(id))
    .map(id => (dictionaryInfo(id).needsKey ? `${id}+k` : id))
    .join(',');
