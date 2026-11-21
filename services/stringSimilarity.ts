// Levenshtein distance function to calculate the edit distance between two strings.
export function levenshtein(s1: string, s2: string): number {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else {
        if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }
  return costs[s2.length];
}

// Persian letters written in more than one way (Arabic ي/ك, ZWNJ, the
// marks over letters) are made one, so "مي‌خواهم" and "میخواهم" match.
const normalizePersian = (text: string): string => text
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ؤ]/g, 'و').replace(/[إأآ]/g, 'ا')
  .replace(/[ً-ْٰ]/g, '').replace(/[‌‏‎]/g, ' ')
  .replace(/[.!؟?«»"()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// A typed meaning against a card's back: right when it is any one of the
// meanings the back lists («تصمیم گرفتن، قصد کردن» takes «قصد کردن»), or the
// whole back, with a small typo allowed (more in longer answers). The whole
// back had to be typed before, so a right synonym was marked wrong.
export function meaningMatches(typed: string, back: string): boolean {
  const answer = normalizePersian(typed);
  if (!answer) return false;
  const meanings = [back, ...back.split(/[،,؛;/|\n]|\s+یا\s+/)].map(normalizePersian).filter(Boolean);
  return meanings.some(m => levenshtein(answer, m) <= (m.length > 8 ? 2 : 1) || answer.replace(/ /g, '') === m.replace(/ /g, ''));
}
