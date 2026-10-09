// File: /services/lemma.ts
// Base forms of an English word without a dictionary: the word itself, then
// guesses from its ending, plus common irregular verbs. Shared by the server
// (dictionary lookups) and the reader (highlighting, finding sentences).

// Latin-script words, keeping inner apostrophes and hyphens ("don't",
// "well-known", "naïve") but splitting "word--word" dashes.
export const WORD_TOKEN = /\p{Script=Latin}+(?:['’-]\p{Script=Latin}+)*/gu;
export const tokensOf = (text: string): string[] => text.match(WORD_TOKEN) || [];

// Irregular past forms of verbs that often head a phrasal verb or a card.
export const IRREGULAR_FORMS: Record<string, string> = {
  ate: 'eat', eaten: 'eat', began: 'begin', begun: 'begin', bent: 'bend', bit: 'bite', bitten: 'bite',
  blew: 'blow', blown: 'blow', bore: 'bear', borne: 'bear', bought: 'buy', broke: 'break', broken: 'break',
  brought: 'bring', built: 'build', came: 'come', caught: 'catch', chose: 'choose', chosen: 'choose',
  dealt: 'deal', did: 'do', done: 'do', drew: 'draw', drawn: 'draw', drove: 'drive', driven: 'drive',
  dug: 'dig', fell: 'fall', fallen: 'fall', felt: 'feel', fought: 'fight', flew: 'fly', flown: 'fly',
  forgot: 'forget', forgotten: 'forget', froze: 'freeze', frozen: 'freeze', gave: 'give', given: 'give',
  got: 'get', gotten: 'get', grew: 'grow', grown: 'grow', held: 'hold', hid: 'hide', hidden: 'hide',
  hung: 'hang', kept: 'keep', knew: 'know', known: 'know', laid: 'lay', led: 'lead', lent: 'lend',
  lost: 'lose', made: 'make', meant: 'mean', paid: 'pay', ran: 'run', rode: 'ride', ridden: 'ride',
  rose: 'rise', risen: 'rise', said: 'say', sank: 'sink', sunk: 'sink', saw: 'see', seen: 'see',
  sought: 'seek', sold: 'sell', sent: 'send', shook: 'shake', shaken: 'shake', shot: 'shoot',
  slid: 'slide', spoke: 'speak', spoken: 'speak', spent: 'spend', sprang: 'spring',
  stood: 'stand', stole: 'steal', stolen: 'steal', struck: 'strike', stuck: 'stick', swore: 'swear',
  sworn: 'swear', taught: 'teach', took: 'take', taken: 'take', thought: 'think', threw: 'throw',
  thrown: 'throw', told: 'tell', tore: 'tear', torn: 'tear', understood: 'understand', went: 'go',
  gone: 'go', woke: 'wake', woken: 'wake', wore: 'wear', worn: 'wear', won: 'win', wrote: 'write',
  written: 'write', left: 'leave', fed: 'feed', fled: 'flee', sat: 'sit', slept: 'sleep', swept: 'sweep',
  wept: 'weep', withdrew: 'withdraw', withdrawn: 'withdraw', overcame: 'overcome', undertook: 'undertake',
  undertaken: 'undertake', upheld: 'uphold', withheld: 'withhold', forbade: 'forbid', forbidden: 'forbid',
  forgave: 'forgive', forgiven: 'forgive', foresaw: 'foresee', foreseen: 'foresee', mistook: 'mistake',
  mistaken: 'mistake', strove: 'strive', striven: 'strive', wound: 'wind', bound: 'bind', ground: 'grind',
};

// Irregular plurals of nouns that often get a card.
export const IRREGULAR_PLURALS: Record<string, string> = {
  children: 'child', men: 'man', women: 'woman', mice: 'mouse', feet: 'foot', teeth: 'tooth', geese: 'goose',
  people: 'person', analyses: 'analysis', criteria: 'criterion', phenomena: 'phenomenon', crises: 'crisis',
  theses: 'thesis', hypotheses: 'hypothesis', lives: 'life', wives: 'wife', knives: 'knife', leaves: 'leaf',
  halves: 'half', shelves: 'shelf', wolves: 'wolf', thieves: 'thief',
};

// Words a dictionary writes in place of a real object or subject ("take
// something into account", "be fond of sb"): not looked for in a text.
const PLACEHOLDERS = new Set(['something', 'someone', 'somebody', 'sth', 'sb', 'smb', "one's", 'oneself', "someone's", "somebody's"]);

// How to find a term in a text: its words, without placeholders or a leading
// "be"/"to" ("be fond of sb" -> fond of), unless nothing else is left; and how
// many words may come before each word: one ("take it into account"), or a
// few where a placeholder stood ("take the whole cost into account").
export interface TermPattern { words: string[]; gaps: number[] }

const PLACEHOLDER_GAP = 4;

export const termPattern = (term: string): TermPattern => {
  const all = tokensOf(term.toLowerCase().replace(/’/g, "'"));
  const real = all.filter(w => !PLACEHOLDERS.has(w));
  // One leading "be" or "to" is dropped when other words follow.
  let dropFirst = real.length > 1 && (real[0] === 'be' || real[0] === 'to');
  const words: string[] = [];
  const gaps: number[] = [];
  let gap = 1;
  for (const w of all) {
    if (PLACEHOLDERS.has(w)) { if (words.length > 0) gap = PLACEHOLDER_GAP; continue; }
    if (dropFirst) { dropFirst = false; continue; }
    words.push(w);
    gaps.push(words.length === 1 ? 0 : gap);
    gap = 1;
  }
  return words.length > 0 ? { words, gaps } : { words: all, gaps: all.map((_, i) => (i === 0 ? 0 : 1)) };
};

export const termWords = (term: string): string[] => termPattern(term).words;

// The word as written first, then its likely base forms, most likely first.
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase().replace(/’/g, "'").trim();
  const out = [w];
  const add = (s: string) => { if (s.length >= 3 && !out.includes(s)) out.push(s); };
  if (w.includes(' ')) {
    // Phrases: inflect only the first word ("carried out" -> "carry out").
    const [head, ...rest] = w.split(/\s+/);
    for (const form of lemmaCandidates(head).slice(1)) add(`${form} ${rest.join(' ')}`);
    return out;
  }
  const irregular = IRREGULAR_FORMS[w];
  if (irregular && !out.includes(irregular)) out.push(irregular); // went -> go
  const singular = IRREGULAR_PLURALS[w];
  if (singular && !out.includes(singular)) out.push(singular); // children -> child
  if (w.endsWith("'s")) add(w.slice(0, -2));
  if (w.length < 4) return out;
  // The "e" forms come before the bare stem: noted -> note (not "not"),
  // hopes -> hope (not "hop"), coding -> code (not "cod").
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
  if (w.endsWith('ed')) { add(w.slice(0, -1)); add(w.slice(0, -2)); }
  if (w.endsWith('ing')) { add(w.slice(0, -3) + 'e'); add(w.slice(0, -3)); }
  if (/(ed|ing)$/.test(w)) {
    const stem = w.replace(/(ed|ing)$/, '');
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1)); // stopped -> stop
  }
  if (w.endsWith('ly')) add(w.slice(0, -2));
  return out;
}

// True when `token` (as written in a text) can be a form of `base`.
export const isFormOf = (token: string, base: string): boolean => {
  const t = token.toLowerCase().replace(/’/g, "'");
  const b = base.toLowerCase();
  return t === b || lemmaCandidates(t).includes(b);
};
