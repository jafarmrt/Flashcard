// File: /services/grammarPatterns.ts
// About twenty English grammar structures found by rules alone (no AI, no
// network): the reader lightly highlights them in a sentence, a tap turns one
// into a grammar card from the built-in Persian explanation below, and the
// review screen checks whether a learner's own sentence uses the structure.
// Highlighted structures must be real, so the rules prefer missing a case to
// marking a wrong one.

import { WORD_TOKEN } from './lemma.js';

export interface WordSpan { text: string; start: number; end: number } // a word and its offsets in `text`

export interface GrammarRule {
  id: string;             // kebab-case, stable
  name: string;           // short English name for the card front
  pattern: string;        // the form
  explanation: string;    // Persian, 2-3 sentences
  practicePrompt: string; // Persian: write your own English sentence with this structure
  example: string;        // one natural English example sentence
  keywords: string[];     // lowercase names an AI might give it, for ruleForName
}

export interface GrammarMatch {
  id: string;      // a GrammarRule id
  marks: number[]; // indexes into the `words` passed in, ascending, no duplicates
}

export const GRAMMAR_RULES: GrammarRule[] = [
  {
    id: 'passive',
    name: 'Passive voice',
    pattern: 'be + past participle',
    explanation: 'وقتی انجام‌دهندهٔ کار مهم یا معلوم نیست، از مجهول استفاده می‌کنیم و چیزی که کار روی آن انجام شده در جای فاعل می‌نشیند. ساختش شکلی از be (مثل is، was، been) به‌علاوهٔ اسم مفعول (V3) است و اگر بخواهیم انجام‌دهنده را هم بگوییم، آن را با by می‌آوریم. مثل «نامه نوشته شد» در فارسی که در آن مهم نیست چه کسی نامه را نوشته است.',
    practicePrompt: 'یک جمله بنویس دربارهٔ ساختمان یا چیزی در شهرت که در گذشته ساخته یا اختراع شده، با be + اسم مفعول (مثلاً was built).',
    example: 'The bridge was built in 1932.',
    keywords: ['passive', 'passive voice', 'the passive', 'passive form', 'passive construction', 'passive sentence', 'be + past participle'],
  },
  {
    id: 'present-perfect',
    name: 'Present perfect',
    pattern: 'have/has + past participle',
    explanation: 'حال کامل کاری را نشان می‌دهد که در گذشته انجام شده ولی نتیجه‌اش هنوز به حال مربوط است، یا تجربه‌ای که زمانِ دقیقش مهم نیست. ساختش have یا has به‌علاوهٔ اسم مفعول است و با کلمه‌هایی مثل already، yet، ever، never، just، since و for زیاد می‌آید. به ماضی نقلی فارسی («رفته‌ام») نزدیک است، اما اگر زمانِ گذشته را دقیق بگوییم (yesterday، in 2010) باید گذشتهٔ ساده به کار ببریم.',
    practicePrompt: 'یک جمله بنویس دربارهٔ تجربه‌ای که تا حالا در زندگی‌ات داشته‌ای، با have/has + اسم مفعول.',
    example: 'I have visited Isfahan three times.',
    keywords: ['present perfect', 'present perfect simple', 'present perfect tense', 'have + past participle', 'has + past participle', 'have/has + past participle', 'have + v3'],
  },
  {
    id: 'present-perfect-continuous',
    name: 'Present perfect continuous',
    pattern: 'have/has been + -ing',
    explanation: 'این زمان کاری را نشان می‌دهد که از گذشته شروع شده و تا الان ادامه دارد (یا تازه تمام شده و اثرش پیداست) و تأکیدش بر طول کشیدن کار است. ساختش have/has been به‌علاوهٔ فعل ing‌دار است و معمولاً با for و since می‌آید. در فارسی معمولاً آن را با حال ساده می‌گوییم: «دو ساعت است که منتظرم» یعنی I have been waiting for two hours.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که مدتی پیش شروع کرده‌ای و هنوز ادامه دارد، با have/has been + فعل ing‌دار و for یا since.',
    example: 'She has been learning English for two years.',
    keywords: ['present perfect continuous', 'present perfect progressive', 'present perfect continuous tense', 'have been + ing', 'has been + ing', 'have been + -ing'],
  },
  {
    id: 'past-perfect',
    name: 'Past perfect',
    pattern: 'had + past participle',
    explanation: 'گذشتهٔ کامل کاری را نشان می‌دهد که پیش از یک زمان یا کارِ دیگر در گذشته انجام شده بود؛ یعنی «گذشتهٔ گذشته». ساختش had به‌علاوهٔ اسم مفعول است و برای همهٔ فاعل‌ها یکسان است. معادل ماضی بعید فارسی است: «وقتی رسیدم، قطار رفته بود» یعنی When I arrived, the train had left.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که دیروز پیش از رسیدن دوستت انجام داده بودی، با had + اسم مفعول.',
    example: 'When we got to the cinema, the film had already started.',
    keywords: ['past perfect', 'past perfect simple', 'past perfect tense', 'pluperfect', 'had + past participle', 'had + v3'],
  },
  {
    id: 'past-perfect-continuous',
    name: 'Past perfect continuous',
    pattern: 'had been + -ing',
    explanation: 'این زمان کاری را نشان می‌دهد که مدتی پیش از یک لحظه یا کارِ دیگر در گذشته در جریان بوده و ادامه داشته است. ساختش had been به‌علاوهٔ فعل ing‌دار است و اغلب دلیلِ وضعیتی در گذشته را توضیح می‌دهد. مثلاً «خسته بود، چون تمام روز کار کرده بود» یعنی He was tired because he had been working all day.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که مدتی ادامه داشت تا اتفاق دیگری افتاد، با had been + فعل ing‌دار.',
    example: 'They had been waiting for an hour when the bus finally came.',
    keywords: ['past perfect continuous', 'past perfect progressive', 'past perfect continuous tense', 'had been + ing', 'had been + -ing'],
  },
  {
    id: 'future-perfect',
    name: 'Future perfect',
    pattern: 'will have + past participle',
    explanation: 'آیندهٔ کامل می‌گوید کاری تا یک زمانِ مشخص در آینده تمام شده است. ساختش will have به‌علاوهٔ اسم مفعول است و معمولاً با by (مثل by next year یا by then) می‌آید. در فارسی می‌گوییم «تا سال بعد درسم را تمام کرده‌ام» یعنی By next year I will have finished my studies.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که تا پایان امسال تمامش کرده‌ای، با will have + اسم مفعول و by.',
    example: 'By next June, I will have finished my degree.',
    keywords: ['future perfect', 'future perfect simple', 'future perfect tense', 'will have + past participle', 'will have + v3'],
  },
  {
    id: 'future-continuous',
    name: 'Future continuous',
    pattern: 'will be + -ing',
    explanation: 'آیندهٔ استمراری کاری را نشان می‌دهد که در یک لحظهٔ مشخص در آینده در جریان است، مثل «فردا ساعت هشت دارم کار می‌کنم» یعنی At eight tomorrow I will be working. ساختش will be به‌علاوهٔ فعل ing‌دار است. برای پرسیدن مؤدبانه از برنامهٔ کسی هم به کار می‌رود: Will you be using the car tonight?',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که فردا همین ساعت در حال انجامش هستی، با will be + فعل ing‌دار.',
    example: 'This time next week, we will be lying on the beach.',
    keywords: ['future continuous', 'future progressive', 'future continuous tense', 'will be + ing', 'will be + -ing'],
  },
  {
    id: 'modal-perfect',
    name: 'Modal perfect',
    pattern: 'should/could/might/must + have + past participle',
    explanation: 'فعل‌های وجهی مثل should، could، might و must همراه have و اسم مفعول دربارهٔ گذشته حرف می‌زنند: حدسِ مطمئن (must have یعنی «حتماً … بوده»)، احتمال (might have یعنی «شاید … بوده») یا پشیمانی و انتقاد (should have یعنی «باید … می‌کردی»). مثلاً You should have told me یعنی «باید به من می‌گفتی»، ولی نگفتی.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که در گذشته باید انجام می‌دادی ولی انجام ندادی، با should have + اسم مفعول.',
    example: 'You should have called me earlier.',
    keywords: [
      'modal perfect', 'perfect modal', 'perfect modals', 'modal perfects', 'past modal', 'past modals', 'modals in the past',
      'modal verbs in the past', 'modals of deduction', 'past deduction', 'modal + have + past participle',
      'should have', 'could have', 'might have', 'must have', 'would have', 'may have',
    ],
  },
  {
    id: 'first-conditional',
    name: 'First conditional',
    pattern: 'If + present simple, will + base verb',
    explanation: 'شرطی نوع اول دربارهٔ موقعیتی واقعی و ممکن در حال یا آینده است و نتیجهٔ محتمل آن را می‌گوید. در بخش if زمان حال ساده می‌آید (نه will) و در بخش دیگر will یا can به‌علاوهٔ شکل سادهٔ فعل. مثل «اگر باران بیاید، در خانه می‌مانیم» یعنی If it rains, we will stay home.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که اگر آخر هفته هوا خوب باشد انجام می‌دهی، با If + حال ساده و will.',
    example: 'If you study every day, you will pass the exam.',
    keywords: ['first conditional', 'conditional type 1', 'type 1 conditional', 'conditional 1', '1st conditional', 'real conditional', 'first conditional sentence'],
  },
  {
    id: 'second-conditional',
    name: 'Second conditional',
    pattern: 'If + past simple, would + base verb',
    explanation: 'شرطی نوع دوم دربارهٔ موقعیتی خیالی یا بعید در حال و آینده است. در بخش if گذشتهٔ ساده (و برای be معمولاً were) می‌آید و در بخش دیگر would، could یا might به‌علاوهٔ شکل سادهٔ فعل. گذشته بودنِ فعل اینجا به معنای زمان گذشته نیست و فقط غیرواقعی بودن را نشان می‌دهد، مثل «اگر پولدار بودم، سفر می‌کردم».',
    practicePrompt: 'یک جمله بنویس دربارهٔ کاری که اگر یک میلیون دلار داشتی انجام می‌دادی، با If + گذشتهٔ ساده و would.',
    example: 'If I had more free time, I would learn to play the piano.',
    keywords: ['second conditional', 'conditional type 2', 'type 2 conditional', 'conditional 2', '2nd conditional', 'unreal conditional', 'hypothetical conditional', 'present unreal conditional'],
  },
  {
    id: 'third-conditional',
    name: 'Third conditional',
    pattern: 'If + had + past participle, would have + past participle',
    explanation: 'شرطی نوع سوم دربارهٔ گذشته‌ای است که اتفاق نیفتاده و نتیجهٔ خیالیِ آن، و بیشتر برای پشیمانی یا حسرت به کار می‌رود. در بخش if گذشتهٔ کامل (had + اسم مفعول) و در بخش دیگر would have (یا could have و might have) به‌علاوهٔ اسم مفعول می‌آید. در فارسی می‌گوییم «اگر خبر داشتم، می‌آمدم»، اما در انگلیسی برای گذشته باید گفت If I had known, I would have come.',
    practicePrompt: 'یک جمله بنویس دربارهٔ اتفاقی در گذشته که اگر جور دیگری پیش می‌رفت نتیجه فرق می‌کرد، با If + had + اسم مفعول و would have.',
    example: 'If we had left earlier, we would have caught the train.',
    keywords: [
      'third conditional', 'conditional type 3', 'type 3 conditional', 'conditional 3', '3rd conditional', 'past unreal conditional',
      'past conditional', 'if + had + past participle, would have + past participle', 'if + had + v3, would have + v3',
    ],
  },
  {
    id: 'inversion',
    name: 'Inversion',
    pattern: 'Never / Rarely / Not only … + auxiliary + subject',
    explanation: 'در وارونگی، فعل کمکی پیش از فاعل می‌آید (مثل جملهٔ سؤالی) ولی جمله سؤالی نیست؛ این کار بعد از قیدهای منفی یا محدودکننده مثل Never، Rarely، Hardly، Not only و Only then در ابتدای جمله انجام می‌شود و لحنی تأکیدی و رسمی می‌سازد. در شرطی‌های رسمی هم if حذف می‌شود و فعل کمکی جلو می‌آید: Had I known یعنی If I had known. فارسی چنین ساختی ندارد و تأکید را بیشتر با لحن یا جای کلمه‌ها نشان می‌دهد.',
    practicePrompt: 'یک جمله بنویس که با Never یا Rarely شروع شود و بعد از آن فعل کمکی و فاعل بیاید (مثلاً Never have I…).',
    example: 'Never have I seen such a beautiful sunset.',
    keywords: [
      'inversion', 'negative inversion', 'subject auxiliary inversion', 'subject-auxiliary inversion', 'subject verb inversion',
      'inverted conditional', 'conditional inversion', 'inversion after negative adverbials', 'emphatic inversion',
    ],
  },
  {
    id: 'relative-clause',
    name: 'Relative clause',
    pattern: 'noun + who / which / whose / where / when + clause',
    explanation: 'جملهٔ موصولی دربارهٔ یک اسم توضیح می‌دهد و درست بعد از همان اسم می‌آید، مثل «که» در «مردی که زنگ زد». برای آدم‌ها who (و whom)، برای چیزها which، برای مالکیت whose، برای مکان where و برای زمان when به کار می‌رود. برخلاف فارسی، ضمیر اضافه تکرار نمی‌شود: the book which I read it غلط است و درستش the book which I read است.',
    practicePrompt: 'یک جمله بنویس دربارهٔ کسی که روی زندگی‌ات اثر گذاشته، با who و یک جملهٔ موصولی.',
    example: 'The woman who lives next door is a doctor.',
    keywords: [
      'relative clause', 'relative clauses', 'defining relative clause', 'non defining relative clause', 'non-defining relative clause',
      'relative pronoun', 'relative pronouns', 'adjective clause',
    ],
  },
  {
    id: 'wish',
    name: 'Wish / If only',
    pattern: 'wish / if only + subject + past simple / were / would / had + past participle',
    explanation: 'با wish و if only آرزویی را دربارهٔ چیزی که واقعی نیست بیان می‌کنیم و زمانِ فعل بعد از آن یک قدم به عقب می‌رود. برای آرزو دربارهٔ حال گذشتهٔ ساده می‌آید (I wish I knew)، برای حسرتِ گذشته had + اسم مفعول (I wish I had studied) و برای گلایه از رفتار کسی would (I wish you would stop). مثل «کاش» در فارسی است که آن هم با فعل گذشته می‌آید: «کاش وقت بیشتری داشتم».',
    practicePrompt: 'یک جمله با I wish بنویس دربارهٔ چیزی که دوست داری در زندگی فعلی‌ات فرق داشت.',
    example: 'I wish I spoke French as well as my sister.',
    keywords: ['wish', 'wishes', 'i wish', 'if only', 'wish clause', 'wish clauses', 'wish + past simple', 'wish + past perfect', 'expressing wishes'],
  },
  {
    id: 'used-to',
    name: 'Used to',
    pattern: 'used to + base verb',
    explanation: 'used to برای عادت یا وضعیتی در گذشته به کار می‌رود که دیگر وجود ندارد. بعد از آن شکل سادهٔ فعل می‌آید و در جملهٔ منفی و سؤالی use to می‌شود (didn\'t use to). معادل «قبلاً … می‌کردم» در فارسی است: I used to live in Tabriz یعنی «قبلاً در تبریز زندگی می‌کردم».',
    practicePrompt: 'یک جمله با used to بنویس دربارهٔ کاری که در کودکی زیاد انجام می‌دادی و حالا دیگر انجام نمی‌دهی.',
    example: 'We used to play football in the street after school.',
    keywords: ['used to', 'used to + infinitive', 'used to + base verb', 'past habits', 'past habit', 'used to for past habits'],
  },
  {
    id: 'be-used-to',
    name: 'Be used to',
    pattern: 'be / get used to + -ing or noun',
    explanation: 'be used to یعنی «به چیزی عادت داشتن» و get used to یعنی «به چیزی عادت کردن». بعد از to در این ساخت اسم یا فعل ing‌دار می‌آید، نه شکل سادهٔ فعل: I am used to waking up early. آن را با used to به معنای «قبلاً … می‌کردم» اشتباه نگیر.',
    practicePrompt: 'یک جمله با be used to یا get used to بنویس دربارهٔ چیزی که در زندگی جدیدت به آن عادت کرده‌ای.',
    example: 'After a few months, she got used to driving on the left.',
    keywords: ['be used to', 'get used to', 'be/get used to', 'be used to + ing', 'get used to + ing', 'being used to', 'getting used to'],
  },
  {
    id: 'cleft',
    name: 'Cleft sentence',
    pattern: 'It is/was + focus + that/who + clause',
    explanation: 'جملهٔ برشی (cleft) با It is یا It was یک بخش از جمله را جدا و برجسته می‌کند تا بگوید دقیقاً همین بود، نه چیز دیگری. مثلاً It was John who broke the window یعنی «جان بود که پنجره را شکست». در فارسی هم همین کار را با «… بود که …» می‌کنیم.',
    practicePrompt: 'یک جمله با It was … who یا It was … that بنویس که روی یک نفر یا یک چیز تأکید کند (مثلاً چه کسی اولین بار انگلیسی یادت داد).',
    example: 'It was my grandmother who taught me to cook.',
    keywords: ['cleft sentence', 'cleft sentences', 'cleft', 'it cleft', 'it-cleft', 'cleft construction', 'cleft structure'],
  },
  {
    id: 'participle-clause',
    name: 'Participle clause',
    pattern: 'V-ing / Having + past participle / past participle …, main clause',
    explanation: 'عبارت وصفی (participle clause) جمله‌ای کوتاه‌شده است که به‌جای when، because یا after با فعل ing‌دار، اسم مفعول یا Having + اسم مفعول شروع می‌شود و فاعلش همان فاعل جملهٔ اصلی است. Walking home, I saw a fox یعنی «وقتی به خانه می‌رفتم، روباهی دیدم» و Having finished the work, she left یعنی «بعد از تمام کردن کار، رفت». این ساخت بیشتر در نوشتار می‌آید و جمله را کوتاه و روان می‌کند.',
    practicePrompt: 'یک جمله بنویس که با Having + اسم مفعول یا یک فعل ing‌دار شروع شود و بعد از ویرگول جملهٔ اصلی بیاید.',
    example: 'Having finished her homework, she went out to play.',
    keywords: [
      'participle clause', 'participle clauses', 'participial phrase', 'participial phrases', 'participial clause', 'participle phrase',
      'reduced adverbial clause', 'perfect participle', 'having + past participle',
    ],
  },
  {
    id: 'comparative-correlative',
    name: 'The more…, the more…',
    pattern: 'The + comparative …, the + comparative …',
    explanation: 'این ساخت نشان می‌دهد دو چیز با هم تغییر می‌کنند: هرچه یکی بیشتر شود، دیگری هم بیشتر (یا کمتر) می‌شود. هر بخش با the و یک صفت یا قید تفضیلی شروع می‌شود و دو بخش با ویرگول از هم جدا می‌شوند. معادل «هرچه …، …تر» در فارسی است: The more you read, the more you learn یعنی «هرچه بیشتر بخوانی، بیشتر یاد می‌گیری».',
    practicePrompt: 'یک جمله با The more …, the more … (یا the better و the less) بنویس دربارهٔ یاد گرفتن زبان.',
    example: 'The harder you work, the luckier you get.',
    keywords: [
      'comparative correlative', 'comparative correlatives', 'correlative comparative', 'double comparative', 'double comparatives',
      'the more the more', 'the more the merrier', 'the + comparative, the + comparative', 'parallel increase',
    ],
  },
  {
    id: 'so-such-that',
    name: 'So / such … that',
    pattern: 'so + adjective + that / such (a) + noun + that',
    explanation: 'این ساخت علت و نتیجه را نشان می‌دهد: چیزی آن‌قدر زیاد بود که نتیجه‌ای در پی داشت. بعد از so صفت یا قید می‌آید (so cold that) و بعد از such یک گروه اسمی (such a cold day that). معادل «آن‌قدر … که …» یا «چنان … که …» در فارسی است.',
    practicePrompt: 'یک جمله با so … that یا such … that بنویس دربارهٔ روزی که خیلی خسته یا خوشحال بودی و بگو نتیجه‌اش چه شد.',
    example: 'The film was so boring that I fell asleep.',
    keywords: [
      'so such that', 'so and such', 'so and such that', 'so adjective that', 'so + adjective + that', 'such + noun + that',
      'such a + noun + that', 'so much that', 'result clause', 'result clauses', 'clauses of result',
    ],
  },
  {
    id: 'too-enough',
    name: 'Too / enough + to',
    pattern: 'too + adjective + to + verb / adjective + enough + to + verb',
    explanation: 'too یعنی «بیش از حد» و نشان می‌دهد کاری به همین دلیل ممکن نیست: He is too young to drive یعنی «آن‌قدر جوان است که نمی‌تواند رانندگی کند». enough یعنی «به اندازهٔ کافی» و بعد از صفت می‌آید (old enough to vote) ولی پیش از اسم (enough money to buy). در هر دو حالت بعد از آن to و شکل سادهٔ فعل می‌آید.',
    practicePrompt: 'یک جمله با too … to یا … enough to بنویس دربارهٔ کاری که هنوز نمی‌توانی یا حالا دیگر می‌توانی انجام بدهی.',
    example: 'The box was too heavy to lift.',
    keywords: [
      'too enough', 'too and enough', 'too + adjective + to', 'adjective + enough + to', 'too adjective to', 'adjective enough to',
      'too + infinitive', 'enough + infinitive', 'too to', 'enough to',
    ],
  },
  {
    id: 'not-only-but-also',
    name: 'Not only … but also',
    pattern: 'not only … but (also) …',
    explanation: 'not only … but also دو چیز را کنار هم می‌گذارد و روی دومی تأکید بیشتری دارد، یعنی «نه‌تنها … بلکه … هم». دو بخشی که بعد از not only و but also می‌آیند معمولاً از یک نوع‌اند (دو صفت، دو اسم یا دو فعل). اگر Not only در ابتدای جمله بیاید، فعل کمکی و فاعل جابه‌جا می‌شوند: Not only did he lie, but he also stole.',
    practicePrompt: 'یک جمله با not only … but also بنویس دربارهٔ دو ویژگی خوب یکی از دوستانت.',
    example: 'She is not only a talented singer but also a gifted writer.',
    keywords: ['not only but also', 'not only … but also', 'not only but', 'correlative conjunction', 'correlative conjunctions'],
  },
  {
    id: 'had-better-would-rather',
    name: 'Had better / would rather',
    pattern: 'had better / would rather + base verb',
    explanation: 'had better برای توصیهٔ جدی یا هشدار است، یعنی «بهتر است …» (وگرنه پیامد بدی دارد)، و would rather برای ترجیح است، یعنی «ترجیح می‌دهم …». بعد از هر دو شکل سادهٔ فعل بدون to می‌آید و منفی‌شان had better not و would rather not است. در گفتار معمولاً کوتاه می‌شوند: You\'d better و I\'d rather.',
    practicePrompt: 'یک جمله با I\'d rather یا You\'d better بنویس دربارهٔ برنامه‌ات برای امشب.',
    example: 'You\'d better take an umbrella; it\'s going to rain.',
    keywords: ['had better', 'would rather', 'had better would rather', 'had better / would rather', 'you\'d better', 'i\'d rather', 'd better', 'd rather'],
  },
  {
    id: 'as-if',
    name: 'As if / as though',
    pattern: 'as if / as though + clause',
    explanation: 'as if و as though یعنی «انگار که» و حالت یا ظاهرِ چیزی را با یک مقایسه توصیف می‌کنند. اگر موقعیت واقعی نباشد، فعل بعد از آن یک قدم به گذشته می‌رود: He talks as if he knew everything یعنی «طوری حرف می‌زند که انگار همه‌چیز را می‌داند». بیشتر بعد از فعل‌هایی مثل look، seem، feel، act و talk می‌آید.',
    practicePrompt: 'یک جمله با as if یا as though بنویس دربارهٔ کسی که رفتارش با واقعیت جور درنمی‌آید.',
    example: 'He looked as if he had seen a ghost.',
    keywords: ['as if', 'as though', 'as if / as though', 'as if clause', 'as though clause'],
  },
];

const RULE_MAP = new Map(GRAMMAR_RULES.map(r => [r.id, r]));
export const ruleById = (id: string): GrammarRule | undefined => RULE_MAP.get(id);
const RULE_ORDER = new Map(GRAMMAR_RULES.map((r, i) => [r.id, i]));

// --- Word lists ---

const wordSet = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean));

const PP_IRREGULAR = wordSet(`
  been done gone seen taken given written spoken broken chosen driven eaten fallen forgotten frozen hidden known ridden
  risen shaken stolen sworn thrown torn worn woken grown drawn flown blown shown begun sung swum drunk rung run come
  become overcome made built sent kept left lost paid said sold told thought taught bought brought caught fought sought
  found held heard felt met read put cut set let hit hurt shut spent lent bent meant slept swept wept fed fled led sat
  stood understood hung dug stuck struck won bound wound laid forgiven forbidden mistaken undertaken withdrawn withheld
  upheld foreseen got gotten had dealt beaten bitten borne born sunk shrunk stung swung spun clung flung wrung sprung
  strung lit shot slid split spread quit cast cost burst thrust shed bred sped knelt crept dreamt learnt burnt spelt
  spilt leapt dwelt sewn shone sown mown proven striven forsaken outgrown overtaken overthrown overseen overheard
  overdone undone redone rewritten retold rebuilt misunderstood misled withstood`);

// Past participles that are also the base form ("come", "read"): not a sign of a
// past participle on their own at the start of a sentence, and still a base verb.
const BASE_PP = wordSet('run come become overcome read put cut set let hit hurt shut quit cast cost burst thrust shed spread split');

// Irregular past simple forms (also "was", "could"), for if-clauses and wishes.
const PAST_SIMPLE = wordSet(`
  was were did had could ate began bit blew bought broke brought built came caught chose dealt drew drove dug fell felt
  fought flew forgot froze gave got grew held hid hung kept knew laid led lent lost made meant met paid ran rode rose
  said sank saw sought sold sent shook shot slid spoke spent sprang stood stole struck stuck swore taught took thought
  threw told tore understood went woke wore won wrote left fed fled sat slept swept wept withdrew overcame forgave
  foresaw mistook found heard sang swam drank rang became bent lit shone spun swung stung clung flung knelt crept forbade`);

// -ed words that are not verbs, and -eed words that are past participles.
const NOT_VERB_ED = wordSet(`
  hundred sacred naked wicked beloved rugged crooked ragged jagged wretched hatred kindred bed red sled fred ned ted
  ahmed hamed mohammed mohamed javed rashed majed vahed fahed infrared embed biped moped`);
const EED_PP = wordSet('agreed freed guaranteed decreed disagreed refereed');

// After "be" these read as adjectives (or are not passive at all).
const NOT_PASSIVE = wordSet(`
  tired interested bored excited worried married pleased amazed scared frightened terrified embarrassed annoyed confused
  disappointed satisfied relaxed shocked exhausted delighted determined concerned ashamed drunk surprised fascinated
  thrilled puzzled stressed depressed impressed astonished alarmed crowded talented aged experienced advanced detailed
  sophisticated complicated qualified skilled renowned retired gone been come become had got gotten arrived happened
  occurred died existed appeared disappeared risen fallen`);

// Intransitive past participles: "she's gone" is "she has gone".
const INTRANSITIVE_PP = wordSet('gone come become arrived happened died fallen risen left been');

// "have mixed feelings", "had limited time": an adjective, not a perfect tense.
const HAVE_ADJ_ED = wordSet('mixed limited varied advanced detailed fixed reserved naked red');

const NOT_VERB_ING = wordSet(`
  thing nothing something anything everything morning evening during ceiling sibling darling pudding king ring sing
  wing bring sting swing spring string cling fling sling wring viking duckling earring offspring lightning awning
  herring shilling inkling according notwithstanding`);
const ADJ_ING = wordSet(`
  interesting exciting boring amazing surprising annoying confusing disappointing embarrassing frightening terrifying
  shocking tiring relaxing satisfying charming convincing encouraging fascinating frustrating overwhelming astonishing
  alarming appealing challenging demanding depressing disgusting entertaining exhausting inspiring intriguing promising
  refreshing rewarding striking stunning thrilling touching worrying willing outstanding missing amusing pleasing`);
// -ing words that open a sentence as a preposition, not a participle clause.
const PREP_ING = wordSet('including regarding concerning considering following excluding barring pending according');
// Base verbs that end in -ing.
const ING_BASE = wordSet('bring sing ring sting swing spring string cling fling sling wring');

const ADVERBS = wordSet(`
  not never already just ever still also always often even recently finally yet all both really only sometimes usually
  certainly probably definitely actually simply nearly almost hardly barely scarcely obviously clearly perhaps soon once
  long now again first quite well much`);
const LY_NOT_ADVERB = wordSet(`
  apply reply supply rely imply comply multiply fly ally rally tally bully sully family italy july holy ugly silly lovely
  friendly lonely lively belly jelly lily folly hilly jolly holly emily molly kelly sally`);

const BE = wordSet('am is are was were be been being');
const HAVE = wordSet('have has had having');
const GET = wordSet('get gets got gotten getting');
const MODALS = wordSet('will would shall should can could may might must');
const AUX = wordSet('am is are was were be been being have has had having do does did will would shall should can could may might must ought');
const INV_AUX = wordSet('do does did have has had is was were are am will would can could should shall may might must');

const SUBJ_PRON = wordSet('i you he she it we they');
const OBJ_PRON = wordSet('me you him her it us them myself yourself himself herself itself ourselves themselves');
const DETS = wordSet('the a an this that these those my your his her its our their some any no every each either neither another such many few several most');

const FUNCTION = wordSet(`
  the a an this that these those my your his her its our their some any no every each either neither all both much many
  few little more most less least other another such what which who whom whose where when why how whether if unless
  because although though while as than then so too very also just only even not never always often sometimes usually
  ever still already yet again here there and or but nor for of in on at by with from to into onto upon about above
  below under over after before during through across along around against among between without within beyond behind
  beside near since until till up down out off away back i you he she it we they me him us them myself yourself
  himself herself itself ourselves themselves one ones something nothing anything everything someone anyone everyone
  nobody somebody anybody everybody mine yours hers ours theirs better rather enough really quite well soon now today
  tomorrow yesterday tonight perhaps maybe instead yes`);

// Words before "who/which" that ask rather than describe ("I know who called").
const REPORT = (() => {
  const out = wordSet(`knew known knowing wondered wondering asked asking told telling saw seen seeing decided deciding
    explained understood remembered forgot forgotten learned learnt showed shown guessed chose chosen discovered
    determined checked cared depended mattered thought found sure unsure unclear clear certain uncertain aware curious
    idea regardless matter whichever whoever`);
  for (const base of `know ask wonder tell see decide explain understand remember forget learn show guess choose discover
    determine check care depend matter think find figure doubt imagine realize realise notice say`.split(/\s+/)) {
    if (base) { out.add(base); out.add(base + 's'); }
  }
  return out;
})();
// Pronouns that can be the noun a relative clause describes ("those who", "anyone who").
const NOUN_PRON = wordSet('those anyone someone everyone anybody somebody everybody one ones he people something everything anything nothing all');
const TIME_NOUNS = wordSet(`day days time times moment moments year years night nights morning mornings evening evenings week
  weeks month months period periods age era season seasons hour hours minute minutes occasion occasions summer winter
  autumn afternoon decade decades century centuries point`);
const REL_PREPS = wordSet('in of to for with by on at from about under through during into upon without between among');
// "I wonder if …", "find out if …": "if" means "whether", not a condition.
const WHETHER_BEFORE = wordSet('know knew wonder wondered wondering ask asked asking asks see saw check checked sure doubt decide decided unsure tell told out remember forget care');

// Words that start the focused part of a cleft sentence ("It was John who", "It was in May that").
const CLEFT_START = wordSet(`the this that these those my your his her its our their me you him her us them we they he she i
  in on at by from with for during after before because only not here then there now today yesterday precisely exactly
  just really actually mainly largely`);
const CLEFT_BLOCK = wordSet(`so such too pity shame wonder surprise miracle relief fact mistake coincidence possibility chance
  truth problem question sign tragedy pleasure privilege secret myth opinion belief hope view feeling impression guess dream
  intention idea understanding advice suggestion`);
// After the first word of the focus: "It was the first time that" is not a cleft.
const CLEFT_BLOCK_LATER = wordSet('best worst most least first last only same kind sort type way time day moment year reason');

const COMPARATIVES = wordSet('more less fewer better worse further farther sooner later longer');

// --- Word tests ---

const isAdverb = (w: string): boolean =>
  ADVERBS.has(w) || (w.length >= 5 && w.endsWith('ly') && !LY_NOT_ADVERB.has(w));

const isRegularEd = (w: string): boolean =>
  w.length >= 4 && w.endsWith('ed') && !NOT_VERB_ED.has(w) && (!w.endsWith('eed') || EED_PP.has(w));

const isPP = (w: string): boolean => PP_IRREGULAR.has(w) || isRegularEd(w);

const isIng = (w: string): boolean => w.length >= 5 && w.endsWith('ing') && !NOT_VERB_ING.has(w);
const isVerbIng = (w: string): boolean => isIng(w) && !ADJ_ING.has(w);

// A plain verb ("stay", "be", "travel"): not a function word, not inflected.
const isBaseVerb = (w: string): boolean => {
  if (w === 'be' || w === 'have' || w === 'do') return true;
  if (!w || FUNCTION.has(w) || AUX.has(w) || !/^[a-z][a-z-]*$/.test(w) || w.length < 2) return false;
  if (BASE_PP.has(w) || ING_BASE.has(w)) return true;
  if (PAST_SIMPLE.has(w) || PP_IRREGULAR.has(w)) return false;
  if (w.endsWith('ing') || (w.endsWith('ed') && !w.endsWith('eed'))) return false;
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return false;
  if (w.length >= 5 && w.endsWith('ly') && !LY_NOT_ADVERB.has(w)) return false;
  return true;
};

const isComparative = (w: string): boolean =>
  COMPARATIVES.has(w) || (w.length >= 5 && w.endsWith('er') && !FUNCTION.has(w));

// --- Tokens: words with contractions expanded ---

// `w` is the expanded, lowercase word; `i` the index of the written word it came from.
interface Tok { w: string; i: number }

const norm = (s: string): string => s.toLowerCase().replace(/’/g, "'");

const NOT_FORMS: Record<string, string> = { "won't": 'will', "can't": 'can', "shan't": 'shall', "ain't": 'is' };
// "'s" after these is "is" or "has"; after a noun it may be a possessive, so it stays.
const S_STEMS = wordSet('it he she that there here what who where when how this everyone someone nobody everything something nothing');

// The first word at or after `j` that is not an adverb (skipping at most two).
const skipAdverbsIn = (ws: string[], j: number): number => {
  let k = j;
  while (k < ws.length && k - j < 2 && isAdverb(ws[k])) k++;
  return k;
};

// "she'd": "had" before a past participle or "better", else "would".
const resolveD = (ws: string[], i: number): string => {
  const next = ws[skipAdverbsIn(ws, i + 1)] ?? '';
  if (next === 'better' || next === 'been') return 'had';
  if (next === 'rather' || next === 'have') return 'would';
  return isPP(next) && !BASE_PP.has(next) ? 'had' : 'would';
};

// "it's": "has" before "been"/"got", an intransitive verb or a verb with an
// object ("she's taken my book"); otherwise "is" ("it's made of wood").
const resolveS = (ws: string[], i: number): string => {
  const j = skipAdverbsIn(ws, i + 1);
  const next = ws[j] ?? '';
  if (next === 'been' || next === 'got' || next === 'gotten') return 'has';
  if (!isPP(next) || BASE_PP.has(next)) return 'is';
  if (INTRANSITIVE_PP.has(next)) return 'has';
  const after = ws[j + 1] ?? '';
  return DETS.has(after) || OBJ_PRON.has(after) ? 'has' : 'is';
};

const expand = (spans: WordSpan[]): Tok[] => {
  const ws = spans.map(s => norm(s.text));
  const out: Tok[] = [];
  ws.forEach((w, i) => {
    const push = (x: string) => out.push({ w: x, i });
    if (w === 'cannot') { push('can'); push('not'); return; }
    if (w.endsWith("n't") && w.length > 3) { push(NOT_FORMS[w] ?? w.slice(0, -3)); push('not'); return; }
    const m = /^([a-z]+)'(ve|ll|re|m|d|s)$/.exec(w);
    if (m && !(m[2] === 's' && !S_STEMS.has(m[1]))) {
      const [, stem, end] = m;
      push(stem);
      push(end === 've' ? 'have' : end === 'll' ? 'will' : end === 're' ? 'are' : end === 'm' ? 'am'
        : end === 'd' ? resolveD(ws, i) : resolveS(ws, i));
      return;
    }
    push(w);
  });
  return out;
};

// --- Detection ---

interface Ctx {
  t: Tok[];
  spans: WordSpan[];
  text: string;
  question: boolean; // the sentence ends with "?"
}
type Add = (id: string, toks: number[]) => void;

const range = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const at = (c: Ctx, k: number): string => c.t[k]?.w ?? '';

// The first token at or after `k` that is not an adverb (skipping at most two).
const skipAdv = (c: Ctx, k: number): number => {
  let j = k;
  while (j < c.t.length && j - k < 2 && isAdverb(c.t[j].w)) j++;
  return j;
};
// The last token before `k` that is not an adverb (skipping at most two).
const prevNonAdv = (c: Ctx, k: number): number => {
  let j = k - 1;
  while (j >= 0 && k - 1 - j < 2 && isAdverb(c.t[j].w)) j--;
  return j;
};

const isFirstOfWord = (c: Ctx, k: number): boolean => k === 0 || c.t[k - 1]?.i !== c.t[k]?.i;
const isLastOfWord = (c: Ctx, k: number): boolean => c.t[k + 1]?.i !== c.t[k]?.i;

// The characters between the word token `k` ends and the next word.
const gapAfter = (c: Ctx, k: number): string => {
  const tok = c.t[k];
  if (!tok || !isLastOfWord(c, k)) return '';
  const end = c.spans[tok.i].end;
  const next = c.spans[tok.i + 1];
  return next ? c.text.slice(end, next.start) : (/^[^\p{L}\p{N}]*/u.exec(c.text.slice(end))?.[0] ?? '');
};
const commaAfter = (c: Ctx, k: number): boolean => gapAfter(c, k).includes(',');
const breakAfter = (c: Ctx, k: number): boolean => /[,;:–—]/.test(gapAfter(c, k));

// A capitalized word that is not the first of the sentence.
const isName = (c: Ctx, k: number): boolean => {
  const tok = c.t[k];
  return !!tok && tok.i > 0 && isFirstOfWord(c, k) && tok.w !== 'i' && /^\p{Lu}/u.test(c.spans[tok.i].text);
};
const isSubjectStart = (c: Ctx, k: number): boolean => {
  const w = at(c, k);
  return SUBJ_PRON.has(w) || DETS.has(w) || w === 'there' || isName(c, k);
};

// Tenses and voice: auxiliary + (up to two adverbs) + verb form.
const tenses = (c: Ctx, add: Add): void => {
  const perfect = (k: number, simple: string, continuous: string) => {
    const j = skipAdv(c, k + 1);
    const p = at(c, j);
    if (p === 'been') {
      const g = skipAdv(c, j + 1);
      if (isVerbIng(at(c, g))) { add(continuous, [k, j, g]); return; }
    }
    if (isPP(p) && !HAVE_ADJ_ED.has(p) && !(p === 'got' && at(c, k) !== 'had')) add(simple, [k, j]);
  };
  for (let k = 0; k < c.t.length; k++) {
    const w = at(c, k);
    const prev = at(c, prevNonAdv(c, k));
    if (BE.has(w)) {
      const j = skipAdv(c, k + 1);
      const p = at(c, j);
      if (isPP(p) && !NOT_PASSIVE.has(p) && !((p === 'used' || p === 'supposed') && at(c, j + 1) === 'to')) {
        add('passive', w === 'being' && BE.has(at(c, k - 1)) ? [k - 1, k, j] : [k, j]);
      }
    }
    if ((w === 'have' || w === 'has') && !MODALS.has(prev) && prev !== 'to') perfect(k, 'present-perfect', 'present-perfect-continuous');
    if (w === 'had' && !MODALS.has(prev)) perfect(k, 'past-perfect', 'past-perfect-continuous');
    if (w === 'will' || w === 'shall') {
      const j = skipAdv(c, k + 1);
      if (at(c, j) === 'have') {
        const p = skipAdv(c, j + 1);
        if (isPP(at(c, p))) add('future-perfect', [k, j, p]);
      } else if (at(c, j) === 'be') {
        const g = skipAdv(c, j + 1);
        if (isVerbIng(at(c, g))) add('future-continuous', [k, j, g]);
      }
    }
    if (['should', 'could', 'might', 'must', 'would', 'may', 'can'].includes(w)) {
      const j = skipAdv(c, k + 1);
      const p = skipAdv(c, j + 1);
      if (at(c, j) === 'have' && isPP(at(c, p))) add('modal-perfect', [k, j, p]);
    }
  }
};

// --- Conditionals ---

const PAST_MODALS = ['would', 'could', 'might'];
const FIRST_MODALS = ['will', 'shall', 'can', 'may'];

const isPastSimple = (c: Ctx, k: number): boolean => {
  const w = at(c, k);
  const prev = at(c, k - 1);
  if (w === 'were' || w === 'was' || w === 'did' || w === 'could') return true;
  if (w === 'had') return !isPP(at(c, skipAdv(c, k + 1)));
  if (BE.has(prev) || HAVE.has(prev) || GET.has(prev) || prev === 'to' || DETS.has(prev)) return false;
  return PAST_SIMPLE.has(w) || isRegularEd(w);
};

const isPresent = (c: Ctx, k: number): boolean => {
  const w = at(c, k);
  if (['am', 'is', 'are', 'do', 'does', 'has', 'have'].includes(w)) return true;
  if (FUNCTION.has(w) || AUX.has(w) || isAdverb(w)) return false;
  if (SUBJ_PRON.has(at(c, k - 1)) && isBaseVerb(w)) return true;
  return w.length >= 3 && /^[a-z]+s$/.test(w) && !/(ss|us|is)$/.test(w);
};

// "Had I known,", "Were I rich,", "Should you need help,": the index of the
// token before the comma that closes the clause, or -1.
const conditionalInversion = (c: Ctx): number => {
  const w0 = at(c, 0);
  if (!['had', 'were', 'should'].includes(w0) || !isLastOfWord(c, 0) || c.question || !isSubjectStart(c, 1)) return -1;
  let end = -1;
  for (let k = 1; k < Math.min(c.t.length - 1, 9); k++) if (commaAfter(c, k)) { end = k; break; }
  if (end < 1) return -1;
  if (w0 === 'had' && !range(2, end + 1).some(k => isPP(at(c, k)))) return -1;
  if (w0 === 'should' && !isBaseVerb(at(c, skipAdv(c, 2)))) return -1;
  return end;
};

const conditionalTypes = (c: Ctx, add: Add, head: number, ifPart: number[], main: number[], kind: string): void => {
  const inIf = new Set(ifPart);
  const inMain = new Set(main);
  const modalHave = (): number[] | null => {
    for (const m of main) {
      if (!PAST_MODALS.includes(at(c, m))) continue;
      const h = skipAdv(c, m + 1);
      const p = skipAdv(c, h + 1);
      if (at(c, h) === 'have' && inMain.has(p) && isPP(at(c, p))) return [m, h, p];
    }
    return null;
  };
  const modalBase = (modals: string[]): number[] | null => {
    for (const m of main) {
      if (!modals.includes(at(c, m))) continue;
      const b = skipAdv(c, m + 1);
      const w = at(c, b);
      if (inMain.has(b) && isBaseVerb(w) && !(w === 'have' && isPP(at(c, skipAdv(c, b + 1))))) return [m, b];
    }
    return null;
  };

  // Third: had + past participle in the if-clause, would have + past participle in the other.
  let hadPP: number[] | null = null;
  if (kind === 'had') {
    const p = ifPart.find(k => isPP(at(c, k)) && at(c, k) !== 'had');
    if (p !== undefined) hadPP = [p];
  } else {
    for (const k of ifPart) {
      const p = skipAdv(c, k + 1);
      if (at(c, k) === 'had' && inIf.has(p) && isPP(at(c, p))) { hadPP = [k, p]; break; }
    }
  }
  if (hadPP) {
    const mh = modalHave();
    if (mh) add('third-conditional', [head, ...hadPP, ...mh]);
    return;
  }
  if (kind === 'had' || ifPart.some(k => ['will', 'would', 'shall'].includes(at(c, k)))) return;

  // Second: a past form in the if-clause, would/could/might + base verb in the other.
  const past = ifPart.find(k => isPastSimple(c, k));
  if (past !== undefined || kind === 'were') {
    const mb = modalBase(PAST_MODALS);
    if (mb) add('second-conditional', [head, ...(past !== undefined ? [past] : []), ...mb]);
    return;
  }
  if (kind !== 'if' || ifPart.some(k => at(c, k) === 'had')) return;

  // First: a present form in the if-clause, will/can/may + base verb in the other.
  const present = ifPart.find(k => isPresent(c, k));
  const mb = present === undefined ? null : modalBase(FIRST_MODALS);
  if (mb) add('first-conditional', [head, present!, ...mb]);
};

const conditionals = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  for (let k = 0; k < n; k++) {
    const w = at(c, k);
    if (w !== 'if' && w !== 'unless') continue;
    const prev = at(c, k - 1);
    if (prev === 'as' || prev === 'what' || WHETHER_BEFORE.has(prev) || at(c, k + 1) === 'only') continue;
    // The if-clause runs to the next comma, or (with no comma and nothing
    // before it) up to the modal of the main clause.
    const modalBefore = c.t.slice(0, k).some(x => MODALS.has(x.w));
    let end = -1;
    for (let m = k + 1; m < n; m++) if (breakAfter(c, m)) { end = m; break; }
    let ifEnd: number;
    if (!modalBefore && end < 0) {
      ifEnd = k + 2;
      while (ifEnd < n && !MODALS.has(at(c, ifEnd))) ifEnd++;
    } else {
      ifEnd = end >= 0 ? end + 1 : n;
    }
    const main = modalBefore ? [...range(0, k), ...range(ifEnd, n)] : range(ifEnd, n);
    conditionalTypes(c, add, k, range(k + 1, ifEnd), main, 'if');
  }
  const inv = conditionalInversion(c);
  if (inv >= 0) conditionalTypes(c, add, 0, range(1, inv + 1), range(inv + 1, n), at(c, 0));
};

// --- Inversion ---

// Sentence-opening negative adverbials; `true` when a clause comes before the
// auxiliary ("Only when I saw it did I …").
const NEG_OPENERS: Array<[string[], boolean]> = [
  [['under', 'no', 'circumstances'], false], [['at', 'no', 'time'], false], [['on', 'no', 'account'], false],
  [['in', 'no', 'way'], false], [['not', 'only'], false], [['no', 'sooner'], false], [['no', 'longer'], false],
  [['not', 'once'], false], [['only', 'then'], false], [['only', 'later'], false], [['only', 'now'], false],
  [['only', 'when'], true], [['only', 'after'], true], [['only', 'by'], true], [['only', 'if'], true],
  [['only', 'once'], true], [['not', 'until'], true], [['not', 'till'], true],
  [['never'], false], [['rarely'], false], [['seldom'], false], [['hardly'], false], [['scarcely'], false],
  [['barely'], false], [['little'], false], [['nowhere'], false],
];
const SKIP_AFTER_NEG = wordSet('before again ever once since then yet');
// Pronouns that can only be subjects: "when she had …" is not inverted, "saw it did I" is.
const SUBJECT_ONLY = wordSet('i he she we they');

// The subject after an inverted auxiliary: a pronoun or a name, or a noun phrase
// followed by a verb that fits the auxiliary ("Rarely do the students complain",
// not the order "Never do that again").
const invertedSubject = (c: Ctx, j: number): boolean => {
  const aux = at(c, j);
  const s = at(c, j + 1);
  if (SUBJ_PRON.has(s)) return !(aux === 'do' && s === 'it');
  if (isName(c, j + 1)) return true;
  if (!DETS.has(s) && s !== 'there') return false;
  if (BE.has(aux)) return true;
  const fits = HAVE.has(aux) ? isPP : isBaseVerb;
  return (s === 'there' ? [j + 2, j + 3] : [j + 3, j + 4, j + 5]).some(m => fits(at(c, m)));
};

const inversion = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  const opener = NEG_OPENERS.find(([ws]) => ws.every((x, k) => at(c, k) === x && c.t[k].i === k));
  if (opener) {
    const [ws, clause] = opener;
    const len = ws.length;
    if (!clause) {
      let j = len;
      while (j < len + 2 && SKIP_AFTER_NEG.has(at(c, j))) j++;
      if (INV_AUX.has(at(c, j)) && invertedSubject(c, j)) add('inversion', [...range(0, len), j, j + 1]);
    } else {
      for (let j = len + 1; j < Math.min(n - 1, len + 12); j++) {
        if (INV_AUX.has(at(c, j)) && !SUBJECT_ONLY.has(at(c, j - 1)) && invertedSubject(c, j)) {
          add('inversion', [...range(0, len), j, j + 1]);
          break;
        }
      }
    }
    return;
  }
  if (conditionalInversion(c) >= 0) add('inversion', [0, 1]);
};

// --- Relative clauses ---

const REL = wordSet('who whom whose which');
const OF_WHICH = wordSet('some many most all both none each several few one two half');

// A word that can be the noun a relative clause describes.
const isNounish = (c: Ctx, a: number): boolean => {
  const w = at(c, a);
  if (NOUN_PRON.has(w)) return true;
  if (FUNCTION.has(w) || AUX.has(w) || REPORT.has(w) || isAdverb(w) || PAST_SIMPLE.has(w) || isRegularEd(w)) return false;
  if (isIng(w)) return DETS.has(at(c, a - 1)); // "the building which"
  return /^[a-z][a-z'-]*$/.test(w);
};
const detBefore = (c: Ctx, a: number): boolean => [1, 2, 3].some(d => DETS.has(at(c, a - d)));

const relative = (c: Ctx, add: Add): void => {
  for (let k = 1; k < c.t.length; k++) {
    const w = at(c, k);
    if (REL.has(w)) {
      const viaPrep = w !== 'who' && REL_PREPS.has(at(c, k - 1));
      const a = viaPrep ? k - 2 : k - 1;
      if (a < 0) continue;
      const ok = !viaPrep && commaAfter(c, a)
        ? !REPORT.has(at(c, a)) && !c.question // "He failed, which surprised us"
        : isNounish(c, a) || (at(c, k - 1) === 'of' && OF_WHICH.has(at(c, a))); // "many of whom"
      if (ok) add('relative-clause', viaPrep ? [a, k - 1, k] : [a, k]);
    } else if (w === 'where' || w === 'when') {
      const a = k - 1;
      const ok = w === 'when'
        ? TIME_NOUNS.has(at(c, a)) && detBefore(c, a)
        : isNounish(c, a) && (detBefore(c, a) || isName(c, a) || /[^s]s$/.test(at(c, a)));
      if (ok) add('relative-clause', [a, k]);
    }
  }
};

// --- Wishes, used to ---

const WISH_VERBS = wordSet('were was had would could did knew might');

const wish = (c: Ctx, add: Add): void => {
  const verbAfter = (s: number): number => {
    if (!(SUBJ_PRON.has(at(c, s)) || isName(c, s))) return -1;
    const v = skipAdv(c, s + 1);
    const w = at(c, v);
    return WISH_VERBS.has(w) || PAST_SIMPLE.has(w) || isRegularEd(w) ? v : -1;
  };
  for (let k = 0; k < c.t.length; k++) {
    const w = at(c, k);
    if (w === 'wish' || w === 'wishes' || w === 'wished') {
      const v = verbAfter(at(c, k + 1) === 'that' ? k + 2 : k + 1);
      if (v >= 0) add('wish', [k, v]);
    } else if (w === 'if' && at(c, k + 1) === 'only') {
      const v = verbAfter(k + 2);
      if (v >= 0) add('wish', [k, k + 1, v]);
    }
  }
};

const usedTo = (c: Ctx, add: Add): void => {
  for (let k = 0; k < c.t.length; k++) {
    const w = at(c, k);
    if (at(c, k + 1) !== 'to') continue;
    const x = at(c, k + 2);
    if (w === 'used') {
      const p = prevNonAdv(c, k);
      const before = at(c, p);
      if (GET.has(before) && x) add('be-used-to', [p, k, k + 1]);
      else if (BE.has(before)) {
        if (isIng(x) || DETS.has(x) || OBJ_PRON.has(x)) add('be-used-to', [p, k, k + 1]);
      } else if (!HAVE.has(before) && isBaseVerb(x)) add('used-to', [k, k + 1]);
    } else if (w === 'use' && at(c, k - 1) === 'not' && at(c, k - 2) === 'did' && isBaseVerb(x)) {
      add('used-to', [k - 2, k, k + 1]); // "didn't use to"
    }
  }
};

// --- Sentence shapes ---

const CLEFT_SOFT = wordSet('not just only really actually precisely exactly simply mainly largely');

// "It was John who …", "It is in May that …"
const cleft = (c: Ctx, add: Add): void => {
  if (at(c, 0) !== 'it' || (at(c, 1) !== 'is' && at(c, 1) !== 'was')) return;
  if (!(CLEFT_START.has(at(c, 2)) || isName(c, 2))) return;
  for (let j = 3; j < Math.min(c.t.length - 1, 10); j++) {
    const w = at(c, j);
    if (w === 'that' || w === 'who' || w === 'whom') {
      if (range(2, j).some(k => !CLEFT_SOFT.has(at(c, k)))) add('cleft', [0, 1, j]);
      return;
    }
    if (CLEFT_BLOCK.has(w) || CLEFT_BLOCK_LATER.has(w) || (AUX.has(w) && !isName(c, j)) || breakAfter(c, j - 1)) return;
  }
};

const NOT_PARTICIPLE_START = wordSet('had been got gotten given provided granted said');

// "Having finished the work, …", "Walking home, …", "Built in 1890, …"
const participle = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  const k = at(c, 0) === 'not' && c.t[0].i === 0 ? 1 : 0;
  const w = at(c, k);
  if (!w || !isFirstOfWord(c, k) || !isLastOfWord(c, k)) return;
  let comma = -1;
  for (let m = k; m < Math.min(n - 1, k + 8); m++) if (commaAfter(c, m)) { comma = m; break; }
  if (comma < 0) return;
  const after = at(c, comma + 1);
  if (after === 'and' || after === 'or' || after === 'which' || after === 'who' || isIng(after)) return; // a list
  if (w === 'having') {
    const p = skipAdv(c, k + 1);
    if (p <= comma && isPP(at(c, p))) add('participle-clause', [...range(0, k + 1), p]);
    return;
  }
  const ing = isVerbIng(w) && !PREP_ING.has(w);
  const pp = isPP(w) && !BASE_PP.has(w) && !NOT_PARTICIPLE_START.has(w);
  if (ing || pp) add('participle-clause', range(0, k + 1));
};

// "The more you read, the more you learn."
const comparativeCorrelative = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  for (let k = 0; k < n - 3; k++) {
    if (at(c, k) !== 'the' || !isComparative(at(c, k + 1))) continue;
    for (let b = k + 2; b < n - 1; b++) {
      if (at(c, b) !== 'the' || !commaAfter(c, b - 1) || !isComparative(at(c, b + 1))) continue;
      if (b === k + 2 && !COMPARATIVES.has(at(c, k + 1))) continue; // "The singer, the dancer"
      add('comparative-correlative', [k, k + 1, b, b + 1]);
      return;
    }
  }
};

const SO_QUANTITY = wordSet('much many few little well far long');

const soSuchThat = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  const thatWithin = (from: number, to: number): number => {
    for (let j = from; j < Math.min(n, to); j++) {
      if (at(c, j) === 'that') return j;
      if (breakAfter(c, j) && at(c, j + 1) !== 'that') return -1;
    }
    return -1;
  };
  for (let k = 0; k < n - 2; k++) {
    const w = at(c, k);
    const a = at(c, k + 1);
    if (w === 'so') {
      if (k > 0 && (commaAfter(c, k - 1) || ['and', 'but', 'or'].includes(at(c, k - 1)))) continue; // "…, so we left"
      if (!a || a === 'that' || a === 'as' || SUBJ_PRON.has(a) || AUX.has(a) || (FUNCTION.has(a) && !SO_QUANTITY.has(a))) continue;
      const j = thatWithin(k + 2, k + 8);
      if (j >= 0) add('so-such-that', [k, k + 1, j]);
    } else if (w === 'such') {
      if (!a || a === 'as' || a === 'that') continue;
      const j = thatWithin(k + 2, k + 8);
      if (j >= 0) add('so-such-that', a === 'a' || a === 'an' ? [k, k + 1, j] : [k, j]);
    }
  }
};

const tooEnough = (c: Ctx, add: Add): void => {
  const n = c.t.length;
  const toVerb = (j: number): boolean => at(c, j) === 'to' && isBaseVerb(at(c, j + 1));
  for (let k = 0; k < n - 2; k++) {
    const w = at(c, k);
    const a = at(c, k + 1);
    if (w === 'too') {
      if (FUNCTION.has(a) && !SO_QUANTITY.has(a)) continue;
      const j = [k + 2, k + 3].find(toVerb);
      if (j !== undefined) add('too-enough', range(k, j + 1));
    } else if (w === 'enough') {
      const b = at(c, k - 1);
      if (toVerb(k + 1)) {
        if (b && !FUNCTION.has(b) && !AUX.has(b) && !OBJ_PRON.has(b) && !PAST_SIMPLE.has(b) && !isRegularEd(b) && !isIng(b)) {
          add('too-enough', [k - 1, k, k + 1]); // "old enough to vote"
        }
      } else if (a && !FUNCTION.has(a) && !AUX.has(a)) {
        const j = [k + 2, k + 3].find(toVerb);
        if (j !== undefined) add('too-enough', range(k, j + 1)); // "enough money to buy"
      }
    }
  }
};

const notOnlyButAlso = (c: Ctx, add: Add): void => {
  for (let k = 0; k < c.t.length - 3; k++) {
    if (at(c, k) !== 'not' || at(c, k + 1) !== 'only') continue;
    for (let j = k + 3; j < c.t.length; j++) {
      if (at(c, j) !== 'but') continue;
      const also = [j + 1, j + 2, j + 3].find(m => at(c, m) === 'also');
      add('not-only-but-also', [k, k + 1, j, ...(also !== undefined ? [also] : [])]);
      return;
    }
  }
};

const betterRather = (c: Ctx, add: Add): void => {
  for (let k = 0; k < c.t.length - 2; k++) {
    const w = at(c, k);
    const x = at(c, k + 2);
    if (w === 'had' && at(c, k + 1) === 'better' && (isBaseVerb(x) || x === 'not')) add('had-better-would-rather', [k, k + 1]);
    if (w === 'would' && at(c, k + 1) === 'rather' && (isBaseVerb(x) || x === 'not' || SUBJ_PRON.has(x))) add('had-better-would-rather', [k, k + 1]);
  }
};

const asIf = (c: Ctx, add: Add): void => {
  for (let k = 0; k < c.t.length - 1; k++) {
    if (at(c, k) === 'as' && (at(c, k + 1) === 'if' || at(c, k + 1) === 'though')) add('as-if', [k, k + 1]);
  }
};

const DETECTORS = [
  tenses, conditionals, inversion, relative, wish, usedTo, cleft, participle,
  comparativeCorrelative, soSuchThat, tooEnough, notOnlyButAlso, betterRather, asIf,
];

// A match is dropped when a more specific structure shares one of its words:
// "had been working" is not also past perfect, the "would have" of a third
// conditional is not also a modal perfect.
const SUBSUMES: Record<string, string[]> = {
  'third-conditional': ['past-perfect', 'modal-perfect'],
  'past-perfect-continuous': ['past-perfect'],
  'present-perfect-continuous': ['present-perfect'],
  'be-used-to': ['passive', 'used-to'],
  cleft: ['relative-clause'],
};

export function detectGrammar(text: string, words: WordSpan[]): GrammarMatch[] {
  if (!words.length) return [];
  const t = expand(words);
  const tail = /^[^\p{L}\p{N}]*/u.exec(text.slice(words[words.length - 1].end))?.[0] ?? '';
  const c: Ctx = { t, spans: words, text, question: /^[^.!?]*\?/.test(tail) };
  const found: GrammarMatch[] = [];
  const add: Add = (id, toks) => {
    const marks = [...new Set(toks.filter(k => k >= 0 && k < t.length).map(k => t[k].i))].sort((a, b) => a - b);
    if (marks.length && !found.some(f => f.id === id && f.marks.join() === marks.join())) found.push({ id, marks });
  };
  for (const detect of DETECTORS) detect(c, add);
  const kept = found.filter(f => !found.some(g =>
    g !== f && (SUBSUMES[g.id] ?? []).includes(f.id) && g.marks.some(m => f.marks.includes(m))));
  return kept.sort((a, b) => a.marks[0] - b.marks[0] || RULE_ORDER.get(a.id)! - RULE_ORDER.get(b.id)!);
}

export function wordSpans(text: string): WordSpan[] {
  const out: WordSpan[] = [];
  for (const m of text.matchAll(new RegExp(WORD_TOKEN.source, WORD_TOKEN.flags))) {
    out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

export function grammarIdsIn(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/[^.!?]+[.!?]*/g)) {
    for (const g of detectGrammar(m[0], wordSpans(m[0]))) ids.add(g.id);
  }
  return GRAMMAR_RULES.map(r => r.id).filter(id => ids.has(id));
}

// --- Naming ---

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const RULE_KEYS = GRAMMAR_RULES.map(r => ({ rule: r, keys: [...new Set([r.name, ...r.keywords].map(normName))].filter(Boolean) }));

// The rule whose keyword is the longest whole phrase in the name (or, failing
// that, in the pattern); undefined when none matches.
export function ruleForName(name: string, pattern?: string): GrammarRule | undefined {
  for (const source of [name, pattern ?? '']) {
    const hay = ` ${normName(source)} `;
    if (!hay.trim()) continue;
    let best: GrammarRule | undefined;
    let bestLen = 0;
    for (const { rule, keys } of RULE_KEYS) {
      for (const key of keys) {
        if (key.length > bestLen && hay.includes(` ${key} `)) { best = rule; bestLen = key.length; }
      }
    }
    if (best) return best;
  }
  return undefined;
}
