import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGrammar, GRAMMAR_RULES, grammarIdsIn, ruleById, ruleForName, wordSpans } from '../services/grammarPatterns';

// The rule ids found in one sentence, sorted.
const ids = (sentence: string): string[] =>
  [...new Set(detectGrammar(sentence, wordSpans(sentence)).map(m => m.id))].sort();

// The marked words of the first match with this id.
const marked = (sentence: string, id: string): string[] | undefined => {
  const words = wordSpans(sentence);
  const match = detectGrammar(sentence, words).find(m => m.id === id);
  return match?.marks.map(i => words[i].text);
};

const expectIds = (cases: Array<[string, string[]]>) => {
  for (const [sentence, expected] of cases) assert.deepEqual(ids(sentence), [...expected].sort(), sentence);
};

test('passive voice, but not adjectives, "be used to" or "be supposed to"', () => {
  assert.deepEqual(marked('The letter was written by my aunt.', 'passive'), ['was', 'written']);
  assert.deepEqual(marked('The house is being built.', 'passive'), ['is', 'being', 'built']);
  assert.deepEqual(marked('It was not even told to anyone.', 'passive'), ['was', 'told']);
  assert.deepEqual(marked("It's made of wood.", 'passive'), ["It's", 'made']);
  expectIds([
    ['The project will be finished by May.', ['passive']],
    ['I was tired.', []],
    ['She is married.', []],
    ['You will be amazed.', []],
    ["I'm supposed to be there.", []],
    ['Knives are used to cut bread.', []],
  ]);
});

test('perfect and continuous tenses, each reported once', () => {
  assert.deepEqual(marked('I have finished my homework.', 'present-perfect'), ['have', 'finished']);
  assert.deepEqual(marked('They had been waiting for hours.', 'past-perfect-continuous'), ['had', 'been', 'waiting']);
  expectIds([
    ['I have finished my homework.', ['present-perfect']],
    ['I have three tickets.', []],
    ['He has got a car.', []],
    ['They have mixed feelings.', []],
    ['We have already been told.', ['passive', 'present-perfect']],
    ["She's finished her homework.", ['present-perfect']],
    ["He's gone.", ['present-perfect']],
    ['She has been learning English for two years.', ['present-perfect-continuous']],
    ["It's been raining all day.", ['present-perfect-continuous']],
    ['They had been waiting for hours.', ['past-perfect-continuous']],
    ['When we arrived, the film had already started.', ['past-perfect']],
    ["She'd gone before I arrived.", ['past-perfect']],
    ['He had never really seen the sea.', ['past-perfect']],
    ['By next June, I will have finished my degree.', ['future-perfect']],
    ['This time next week, we will be lying on the beach.', ['future-continuous']],
    ['It will be interesting.', []],
    ['You should have told me.', ['modal-perfect']],
    ["He can't have known.", ['modal-perfect']],
    ['I have to go.', []],
  ]);
});

test('curly apostrophes and contractions keep the index of the written word', () => {
  const sentence = 'I’ve never seen it.';
  assert.deepEqual(ids(sentence), ['present-perfect']);
  const words = wordSpans(sentence);
  assert.deepEqual(detectGrammar(sentence, words), [{ id: 'present-perfect', marks: [0, 2] }]);
  assert.deepEqual(marked('You’d better leave now.', 'had-better-would-rather'), ['You’d', 'better']);
  assert.deepEqual(ids("He'd like a coffee."), []);
});

test('conditionals: first, second and third, with the "if" clause first or last', () => {
  assert.deepEqual(marked('If it rains, we will stay home.', 'first-conditional'), ['If', 'rains', 'will', 'stay']);
  assert.deepEqual(marked('If I were rich, I would travel.', 'second-conditional'), ['If', 'were', 'would', 'travel']);
  assert.deepEqual(marked('If I had known, I would have come.', 'third-conditional'), ['If', 'had', 'known', 'would', 'have', 'come']);
  expectIds([
    ['If it rains, we will stay home.', ['first-conditional']],
    ['We will stay home if it rains.', ['first-conditional']],
    ['Unless you hurry, you will miss the bus.', ['first-conditional']],
    ["If you want, I can help.", ['first-conditional']],
    ['If I were rich, I would travel.', ['second-conditional']],
    ['If I had more money, I would buy a car.', ['second-conditional']],
    ['I would go if I could.', ['second-conditional']],
    ['If I had known, I would have come.', ['third-conditional']],
    ["If I'd known, I'd have come.", ['third-conditional']],
    ['If you heat ice, it melts.', []],
    ['If necessary, we will call you.', []],
    ['I wonder if he will come.', []],
    ["I'll see if he is home.", []],
    ['She asked if I was okay.', []],
  ]);
});

test('inversion after a negative adverbial, and inverted conditionals', () => {
  assert.deepEqual(marked('Never have I seen such a mess.', 'inversion'), ['Never', 'have', 'I']);
  // An inverted conditional is reported both as inversion and as its conditional type.
  assert.deepEqual(ids('Had I known, I would have left.'), ['inversion', 'third-conditional']);
  assert.deepEqual(marked('Had I known, I would have left.', 'inversion'), ['Had', 'I']);
  expectIds([
    ['Never have I seen such a mess.', ['inversion']],
    ['Little did he know the truth.', ['inversion']],
    ['Rarely do the students complain.', ['inversion']],
    ['No sooner had I sat down than the phone rang.', ['inversion']],
    ['Under no circumstances should you open it.', ['inversion']],
    ['Only when I saw her did I understand.', ['inversion']],
    ['Not until I saw it did I believe it.', ['inversion']],
    ['Were I rich, I would travel.', ['inversion', 'second-conditional']],
    ['Should you need help, call me.', ['inversion']],
    // A question, not an inversion: its tense is still found.
    ['Had you seen it?', ['past-perfect']],
    ['Little is known about him.', ['passive']],
    ['Never do that again.', []],
    ['Hardly anyone came.', []],
  ]);
});

test('relative clauses after a noun, not after verbs that ask', () => {
  assert.deepEqual(marked('The man who called you is here.', 'relative-clause'), ['man', 'who']);
  assert.deepEqual(marked('The house in which I live is old.', 'relative-clause'), ['house', 'in', 'which']);
  expectIds([
    ['The man who called you is here.', ['relative-clause']],
    ['She was killed in an accident which happened last year.', ['passive', 'relative-clause']],
    ['My brother, who lives in Paris, is a doctor.', ['relative-clause']],
    ['He failed, which surprised everyone.', ['relative-clause']],
    ['This is the town where I was born.', ['passive', 'relative-clause']],
    ['I remember the day when we met.', ['relative-clause']],
    ['I know who called.', []],
    ['Who is that?', []],
    ["I don't care who wins.", []],
    ['I was happy when she came.', []],
  ]);
});

test('wishes, used to and be used to', () => {
  assert.deepEqual(marked('I wish I had more time.', 'wish'), ['wish', 'had']);
  assert.deepEqual(marked('She is used to waking up early.', 'be-used-to'), ['is', 'used', 'to']);
  assert.deepEqual(marked('He used to live here.', 'used-to'), ['used', 'to']);
  expectIds([
    ['I wish I had more time.', ['wish']],
    ['I wish you would stop.', ['wish']],
    ['If only I had listened.', ['past-perfect', 'wish']],
    ['I wish to speak to the manager.', []],
    ['He used to live here.', ['used-to']],
    ["I didn't use to like coffee.", ['used-to']],
    ['She is used to waking up early.', ['be-used-to']],
    ['He got used to the noise.', ['be-used-to']],
    ["I'm getting used to it.", ['be-used-to']],
  ]);
});

test('cleft sentences, but not "so … that" or "It is important that"', () => {
  assert.deepEqual(marked('It was John who broke the window.', 'cleft'), ['It', 'was', 'who']);
  expectIds([
    ['It was John who broke the window.', ['cleft']],
    ['It was in May that we met.', ['cleft']],
    ['It was so cold that we stayed inside.', ['so-such-that']],
    ['It is important that you come.', []],
    ["It's not that easy.", []],
    ["It's time to go.", []],
  ]);
});

test('participle clauses at the start of a sentence', () => {
  assert.deepEqual(marked('Having finished the work, she went home.', 'participle-clause'), ['Having', 'finished']);
  assert.deepEqual(marked('Walking home, I saw a fox.', 'participle-clause'), ['Walking']);
  expectIds([
    ['Having finished the work, she went home.', ['participle-clause']],
    ['Walking home, I saw a fox.', ['participle-clause']],
    ['Built in 1890, the house is still standing.', ['participle-clause']],
    ['Not knowing what to do, she called me.', ['participle-clause']],
    ['Nothing happened.', []],
    ['Following the meeting, we left.', []],
    ['Running, swimming and cycling are my hobbies.', []],
    ["Interesting, isn't it?", []],
  ]);
});

test('the more …, the more …; so/such … that; too/enough … to', () => {
  assert.deepEqual(marked('The more you read, the more you learn.', 'comparative-correlative'), ['The', 'more', 'the', 'more']);
  assert.deepEqual(marked('It was so cold that we stayed inside.', 'so-such-that'), ['so', 'cold', 'that']);
  assert.deepEqual(marked('He is too young to drive.', 'too-enough'), ['too', 'young', 'to']);
  assert.deepEqual(marked('She is old enough to vote.', 'too-enough'), ['old', 'enough', 'to']);
  expectIds([
    ['The more you read, the more you learn.', ['comparative-correlative']],
    ['The sooner, the better.', ['comparative-correlative']],
    ['It was such a nice day that we went out.', ['so-such-that']],
    ['He worked hard so that he could pass.', []],
    ['I was tired, so I went home.', []],
    ['He is too young to drive.', ['too-enough']],
    ['She is old enough to vote.', ['too-enough']],
    ['We have enough time to finish.', ['too-enough']],
    ["It's too late.", []],
  ]);
});

test('not only … but also, had better / would rather, as if', () => {
  assert.deepEqual(ids('Not only did he lie, but he also stole.'), ['inversion', 'not-only-but-also']);
  assert.deepEqual(marked('Not only did he lie, but he also stole.', 'not-only-but-also'), ['Not', 'only', 'but', 'also']);
  assert.deepEqual(marked('She looked as if she had seen a ghost.', 'as-if'), ['as', 'if']);
  expectIds([
    ['She is not only smart but also kind.', ['not-only-but-also']],
    ["You'd better leave now.", ['had-better-would-rather']],
    ["I'd rather stay home.", ['had-better-would-rather']],
    ['He had better grades than me.', []],
    ['She looked as if she had seen a ghost.', ['as-if', 'past-perfect']],
    ['He talks as though he knew everything.', ['as-if']],
  ]);
});

test('plain sentences have no structure', () => {
  expectIds([
    ['The cat sat on the mat.', []],
    ['I like green tea.', []],
    ['I will call you when I arrive.', []],
  ]);
  assert.deepEqual(detectGrammar('', []), []);
});

test('common look-alikes in real books are not reported', () => {
  expectIds([
    // A dialogue tag between "has" and the participle.
    ['"He has," she said, "gone home."', []],
    // "has" as a main verb before an object.
    ["She's everything I wanted.", []],
    ['There is limited time.', []],
    ['It was unexpected.', []],
    ['The used car was cheap.', []],
    ['We went where to eat was cheap.', []],
    ['The teacher was kind.', []],
    ['Bored, the children left.', []],
    ['Morning, I thought.', []],
  ]);
  expectIds([
    ["She's gone home.", ['present-perfect']],
    ['Have you ever been to Paris?', ['present-perfect']],
    ['It was unexplained by the police.', ['passive']],
    ['Did you use to play?', ['used-to']],
    ['Tired, I went to bed.', ['participle-clause']],
  ]);
});

test('marks point at the words of one sentence inside a longer text', () => {
  const text = 'The cat sat on the mat. The letter was written by my aunt, who lives in Paris.';
  const second = wordSpans(text).slice(6);
  const found = detectGrammar(text, second);
  assert.deepEqual(found.map(m => [m.id, m.marks.map(i => second[i].text)]), [
    ['passive', ['was', 'written']],
    ['relative-clause', ['aunt', 'who']],
  ]);
  assert.deepEqual(wordSpans('I’ve won.'), [{ text: 'I’ve', start: 0, end: 4 }, { text: 'won', start: 5, end: 8 }]);
});

test('grammarIdsIn finds the structures of every sentence, in rule order', () => {
  assert.deepEqual(grammarIdsIn('If it rains, we will stay home. The letter was written by my aunt!'), ['passive', 'first-conditional']);
  assert.deepEqual(grammarIdsIn('I like tea. Had you seen it?'), ['past-perfect']);
  assert.deepEqual(grammarIdsIn('I like tea. It was cold.'), []);
  assert.deepEqual(grammarIdsIn(''), []);
});

test('ruleForName matches the most specific keyword and never guesses', () => {
  assert.equal(ruleForName('Past Perfect Tense')?.id, 'past-perfect');
  assert.equal(ruleForName('Past Perfect Continuous')?.id, 'past-perfect-continuous');
  assert.equal(ruleForName('Passive Voice (Present Simple)')?.id, 'passive');
  assert.equal(ruleForName('Third Conditional (would have)')?.id, 'third-conditional');
  assert.equal(ruleForName('Be used to + -ing')?.id, 'be-used-to');
  assert.equal(ruleForName('Grammar point', 'had + V3')?.id, 'past-perfect');
  assert.equal(ruleForName('Something unknown'), undefined);
  assert.equal(ruleForName('Conditional sentences'), undefined);
  assert.equal(ruleById('cleft')?.name, 'Cleft sentence');
  assert.equal(ruleById('nope'), undefined);
});

test('every rule has a complete card with proper Persian', () => {
  assert.ok(GRAMMAR_RULES.length >= 20);
  assert.equal(new Set(GRAMMAR_RULES.map(r => r.id)).size, GRAMMAR_RULES.length);
  for (const r of GRAMMAR_RULES) {
    assert.match(r.id, /^[a-z]+(-[a-z]+)*$/, r.id);
    for (const field of [r.name, r.pattern, r.example]) assert.ok(field.trim(), `${r.id} has every field`);
    for (const fa of [r.explanation, r.practicePrompt]) {
      assert.match(fa, /[؀-ۿ]/, `${r.id} is in Persian`);
      assert.doesNotMatch(fa, /[يك·]/, `${r.id} uses Persian ی and ک and no middle dot`);
    }
    assert.ok(r.keywords.length > 0 && r.keywords.every(k => k === k.toLowerCase()), `${r.id} keywords`);
    assert.ok(detectGrammar(r.example, wordSpans(r.example)).some(m => m.id === r.id), `${r.id} finds its own example`);
  }
});
