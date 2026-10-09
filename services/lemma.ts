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
