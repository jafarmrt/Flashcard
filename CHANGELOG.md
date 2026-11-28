# Changelog

All notable changes to this project will be documented in this file.

This file is the one place a version is written: the app reads its version,
the changes page and the "new version" notice from the newest entry, and a
test keeps `package.json` on the same version. Every change that reaches
users gets an entry here in the same commit, as
`## [x.y.z] - YYYY-MM-DD - Title` with `- **Label:** text` items: a new
feature raises the middle number, fixes alone raise the last one.

## [7.25.0] - 2026-11-28 - One Review, Wherever You Review
- **The lesson's review is the review you know:** A timed lesson's review step is now the app's own review screen, with all its rules: a card you missed comes back after ten others, a new card is asked twice, a typed meaning is checked, «واگرد» undoes the last answer, and the review modes are there. The lesson had a simpler copy of its own without any of them. Its end screen has «ادامهٔ جلسه», which goes on to the lesson's quiz; a lesson left in the middle still asks only the cards not answered yet.
- **More room on a phone during a lesson:** The list of the lesson's steps is left out on a small screen (the line at the top names the step you are on), so the card and its button are in view.
- **Driving mode, sturdier:** Its audio is now one piece of its own, and a pause or a skip no longer leaves the cut-off sentence waiting in the background.
- **Today for a new account:** With no cards yet, Today says where cards come from, instead of a review box with sizes and modes for zero cards.
- **Up to date at once:** Opening the app now fetches what your other devices changed right away, instead of two seconds after the app has loaded.
- **For development:** A sixth check runs driving mode in the browser with the device's voice replaced, and the lesson check goes through the review, a pause and on to the quiz.

## [7.24.4] - 2026-11-28 - No One Can Lock You Out
- **Your own browser is not locked out:** Twenty wrong passwords lock an account's sign-in for fifteen minutes, and until now that kept the owner out as well: anyone who knew the account name could do it again and again. A browser that has signed in to the account before now keeps a mark of it and may still sign in with the right password while the lock lasts; other browsers wait.
- **Guesses sent all at once are all counted:** Failed sign-ins sent at the same moment were counted as one. They are now counted one by one, so the lock comes after twenty, however they arrive.
- **For the server:** A sync's lock on the account outlasts the longest a function may run, and every request to the cloud store gives up after 15 seconds; Telegram link codes and keys kept aside after a change of secret now expire on their own; every page carries headers that keep other sites from framing the app and limit what it may use of the device (only the microphone).

## [7.24.3] - 2026-11-28 - Reviews Reach Your Other Devices Sooner
- **A review in progress is sent when you leave the app:** Ratings made in a review were sent to the server only when the review ended. A phone locked or closed in the middle of a review kept them until it was opened again, and another device meanwhile asked the same cards from the old schedule. What changed is now sent as soon as the app goes to the background.
- **Driving mode keeps its cards in order:** The order of a drive's cards is fixed when it starts. After a sync it could repeat or skip cards, and the bookmark button could flag a word other than the one being spoken. When the drive stops, the lock screen and the car's display no longer show it as playing.
- **The micro-story stops when you leave it:** Its AI audio went on playing after going back, when the story was a saved one.
- **«تازه‌سازی کش برنامه» only when the server answers:** Offline, or on a network that blocks the site, it removed the files the app opens with, and the app could not start until the connection came back. It now leaves them and says why.
- **Lesson sentences hold still:** The choices of a lesson's fill-in sentences no longer reshuffle while you answer, and a lesson whose words have no sentence to fill in can still be finished.
- **For development:** Five checks run the app in a phone-sized browser on every push (sign-in, reading and making a card, a review, a paused lesson, two devices on one account).

## [7.24.2] - 2026-11-28 - Room for More Saved Speech
- **2 GB of saved AI speech:** Read-aloud audio kept on this device may now take up to 2 GB (about 11 hours), instead of 300 MB. The pieces played least recently still go first when it is full.

## [7.24.1] - 2026-11-28 - Safer Sync, Lighter Driving, Honest Lessons
- **A review that lost on the server comes back:** When the same card was changed on two devices and the server kept the other one (a phone whose clock runs a little slow, for one), the device that lost kept its own version for good, and the card had two different schedules. It now gets the server's version on the same sync.
- **Finished sections and listening spots reach the server:** A chapter's finished sections, minutes read or listening spot that met a newer copy from another device stayed on this device only. They are now sent.
- **Whole books upload at once:** A book's chapter texts went up 20 per sync, so chapters 21 and on of a long book could not be read on another device for a while, and signing out did not warn about them. All of them go up now, and signing out counts them.
- **Driving mode saves less often:** The listening spot was saved, and a full sync started, after every sentence. It is now saved when the section changes, every 30 seconds, and when playback pauses or stops. Listening on one device no longer brings back an older reading position from another. AI speech no longer piles up in memory during a long drive.
- **Kept AI speech has a size limit:** Saved read-aloud audio is kept within 300 MB (it was limited only to 5,000 pieces, which could be gigabytes), least recently played first. The app also asks the browser to keep its storage when the phone runs low on space.
- **A lesson rates each card once:** Resuming a paused lesson asked again the cards already answered and rated them a second time; a miss in the lesson's quiz rated a card already reviewed minutes before. Each card is now rated once per lesson, a lesson keeps to the daily limit of new cards, grammar cards are left out, and the lesson clock no longer goes back after every sync.
- **For the server:** A failed sign-in with a name that has no account no longer leaves a record in the store, records of failures expire, overlong names and passwords are refused at once, and requests are limited to 10 MB. A CI check runs the types, tests, lint and build on every push.

## [7.24.0] - 2026-11-27 - Daily Timed Study Lessons, Bounded Reviews, and Smooth AI Speech
- **«جلسهٔ آموزشی زمان‌بندی‌شده» (30, 45, or 60 minutes):** Build a structured daily lesson from your own flashcards (`۳۰ دقیقه`، `۴۵ دقیقه`، `۶۰ دقیقه`) combining active FSRS review, a mixed four-choice quiz, and contextual sentence consolidation prioritizing words that stayed hard. Every lesson is recorded under its calendar day (`studyLessons`, synced across devices and backups) so you can resume, inspect its words, re-review, or re-test any day's lesson.
- **Bounded word-count rule on every review & cleaner menu:** Removed the standalone «مرور» link from the side menu (since Today already hosts review) and enforced a clear per-session word limit (`۱۰`، `۱۵`، `۲۰`، `۳۰` واژه در هر نوبت، حداکثر ۵۰ کارت) across Today, custom setup, deck, book, and bundle reviews so no review ever dumps an unbounded queue of words.
- **Smooth AI speech playback without mid-line restarts:** Isolated active book and card playback in «حالت رانندگی» from background progress saves and auto-sync refreshes, preventing AI-generated audio from cutting off and restarting from the beginning of a sentence.
- **Automatic PWA shell update check:** Bumped the Service Worker cache (`v5`) and registered `updateViaCache: 'none'` with foreground update checks so mobile installations pick up newly deployed builds promptly.

## [7.23.0] - 2026-11-27 - Audiobook Chapter Picker, Saved AI Voices, and Saved Bundle Exercises
- **Audiobook chapter & section picker + exact resume:** In «حالت رانندگی», choose any chapter (such as Chapter 3) and any section directly from an interactive audiobook picker with completion badges, jump chapters or sections mid-playback via «فصل و بخش», and resume next time from the exact chapter, section, and sentence where listening stopped (`Source.audioPosition`, synced across devices and backups).
- **Persistent AI speech cache without paying twice:** All AI-generated read-aloud audio (OpenRouter and Gemini) is stored in IndexedDB (`LinguaSpeechCache`, up to 5,000 pieces) as universal byte buffers with normalized keys and shared chunk boundaries across Reader, Driving Mode, and Micro-Story playback, alongside one-tap «ذخیرهٔ صدای این بخش» and «ذخیرهٔ صدای کل این فصل» pre-download controls.
- **Saved thematic bundle exercises & anti-repetition:** Micro-stories (`داستانک هم‌بافت`) and close-word drills (`تفکیک واژه‌های نزدیک`) are automatically saved and synced in `themeExercises` so you can replay any past exercise without calling AI again, while new exercises prioritize unseen words/pairs and exclude previously generated scenes and sentences.

## [7.22.0] - 2026-11-26 - Driving Mode, Thematic Bundles, and Vazheh-Khwan Identity
- **«حالت رانندگی»:** Hands-free continuous book listening across section and chapter boundaries plus eyes-free audio vocabulary review (English word and sentence, silent thinking pause, Persian or fallback meaning, and repeat) without altering FSRS schedules, paired with steering-wheel `MediaSession` controls and screen Wake Lock.
- **One-tap driving bookmarks (`نشان‌های رانندگی`):** A giant one-tap button bookmarks the current book sentence or flags the current card without stopping playback; after driving, Today and Driving Mode show a review tray where any word in a bookmarked sentence can be looked up and turned into a card.
- **«بسته‌های موضوعی» (thematic word bundles):** Group flashcards into multi-dimensional thematic scenes (such as forest, animals, history, or emotion) without moving them out of their book decks, with human-approved AI batch sorting, scene-role grouping, cohesive micro-story cloze passages (`داستانک هم‌بافت`), and close-word nuance drills (`تفکیک واژه‌های نزدیک`).
- **Editorial «واژه‌خوان» identity:** Warm archival paper (`#F7F5F0`), library forest green (`#1F6E58`), deep night mode, `Literata` book typography for English headwords and sentences, full Persian sign-in and unified Persian terminology (`واژه‌خوان`, `واژه‌های دیرگیر`, `تمرین و آزمون`), and clean unboxed card metadata.

## [7.21.0] - 2026-11-26 - Mixed Quizzes, Diagnostics, and Safer Sync
- **Mixed four-choice quizzes:** The four-choice quiz now mixes sentence gaps from your books with Persian-to-English, English-to-Persian, and audio-to-meaning questions (or stays on book sentences alone when chosen), while still recording every answer by its English word in «اشتباه‌های من».
- **Quiz the words that stayed hard:** When a review finishes with «هنوز سخت» words, «آزمون چهارگزینه‌ای از همین واژه‌ها» opens a quiz of just those cards right away.
- **«وضعیت و عیب‌یابی»:** A troubleshooting page in «من» and Settings shows your sync revision, unsent cards, reviews, chapter texts and keys, live service checks, plain Persian explanations for recent network, region, key or quota errors, offline cache status with a safe «تازه‌سازی کش برنامه» refresh, and an app install guide.
- **Edited chapters across devices and backups:** Chapters edited on another device or in a newer backup file are now re-fetched in the background, exported in full backups, and restored without losing reading progress.
- **Safer reviews, offline cache, and sign-out:** Undoing a new card's first confirmation in a review asks it twice again, ending a review no longer re-stamps untouched cards, the service worker falls back to the offline page on server 5xx errors with true least-recently-used cache order, and «خروج از همهٔ دستگاه‌ها» revokes AI, speech, and page-fetch endpoints at once.

## [7.20.0] - 2026-11-23 - A Quiz That Teaches When You Are Wrong
- **A hint and a second try:** A wrong choice in the four-choice quiz no longer gives the answer away. The word you picked shows what it means, a hint comes (the Persian meaning of the right word), and you choose once more. The card still counts as not remembered.
- **Both words, side by side:** After a wrong answer the right word and the one you picked stand together with their meanings, from your own cards, and every choice shows its meaning. «چرا؟» asks the AI, only when you want it, to say in a line or two why one fits this sentence and the other does not.
- **Mistakes come back:** A question you got wrong is asked once more at the end of the same quiz. The quiz ends with the list of what went wrong (the word, its meaning, what you picked instead) and «دوباره همین‌ها», a new quiz of just those words.
- **Your answers are kept:** Every first answer in the quiz and in listening practice is now saved with your account and synced: the word, right or wrong, and what you picked instead. They are in the full backup too.
- **«اشتباه‌های من»:** A new tab in practice lists the words you keep getting wrong, what you take them for, and the pairs you mix up, with a quiz made of them. A word leaves the list after two right answers in a row. A word with no usable book sentence is asked from its meaning there.
- **Better choices:** A word that already stands in the sentence is never offered as a choice, and two words with the same meaning are not offered against each other.
- **Closer at hand:** Today's review box has «آزمون چهارگزینه‌ای».

## [7.19.0] - 2026-11-21 - Back to the Book
- **The book starts in Telegram:** The morning message now opens with your book: «کجا بودیم» (the last lines you read), the first lines of the next section and how few minutes it takes, with «ادامه در برنامه», which opens the app on that very page. The day's words follow as before. In the bot, /read sends it any time.
- **An evening reminder, only when needed:** On a day when you finished no section, one short message comes around 7 in the evening with the first lines of the next section. On a day you read, nothing comes. Both can be turned off in Settings › Telegram; /stop stops every automatic message.
- **One small thing first, on Today:** Today now starts with «فقط همین یک بخش»: where you were, the first lines of the next section, about how many minutes, and one button. The plan below it keeps the cards and the pronunciation.
- **Read what you are after:** With nothing in progress, Today invites you to bring what you want to read yourself: a book, an article, or the subtitles of the next episode of the series you are watching.
- **For the server:** A second daily cron (`/api/telegram?cron=evening`) sends the evening reminder on Vercel. The button uses the address the bot is called at; a server that polls Telegram can set `APP_URL`.

## [7.18.0] - 2026-11-21 - A Page That Is Mostly Text
- **The text first:** The reader's top is now one slim bar: back, the title, read aloud, type size and «⋯». Sections, the reading voice, the section's hard words, grammar marks, the colour guide and editing the text are in «⋯». On a phone the first screen shows about nine lines of text; it showed three.
- **Nothing under the paragraphs:** The two links under every paragraph are gone. A paragraph's translation and «از اینجا بخوان» are in a word's sheet; a translation you kept still shows under its paragraph.
- **Grammar marks off until you want them:** The dotted lines under grammar structures are off by default («⋯» or Settings turns them on).
- **«+ کارت» makes the card:** One tap on «+ کارت» in a word's sheet makes its card at once; there is no second «ساخت کارت». (Words from "find hard words" are still ticked in their list and made together.)
- **Review without typing on a phone:** In «خودکار» on a touch screen, the gap in the book's sentence is filled in your mind and then checked against the answer, instead of opening the keyboard for every card. «جای خالی» as a chosen mode is still written.
- **Your word in bold:** In a card's sentences during a review, the word under review is bold.
- **A reminder to back up:** Today says so quietly when you have never saved a backup or the last one is over a month old; Settings shows when the last one was made on this device.

## [7.17.1] - 2026-11-21 - Fixes From Reading on a Phone
- **The next section opens at its top:** After «پایان این بخش و بعدی» the next section opened scrolled to its last lines; it now opens at the first line.
- **«+ کارت» in sight:** On a phone the word's sheet is half the screen and «+ کارت» sat at its end, out of sight. It is now beside the meaning, at the top. The sheet is shorter too: the sentence, which is on the page itself, is no longer repeated in it on small screens.
- **The word stays in view:** A tapped word that would be covered by its sheet moves up into the part of the page still in view, so you read it in its line while the meaning shows.
- **More new cards when you want them:** When today's cards are done and new cards were kept for later by the daily cap, Today offers «۱۰ کارت تازهٔ دیگر».
- **Fewer requests:** A chapter whose text the server does not have is no longer asked for again after every sync.

## [7.17.0] - 2026-11-21 - Your Week in a Glance
- **This week, on Today:** The «این هفته» box now shows the minutes you read (next to the week before), the new cards and «بلدم» words of the week, and how many of your reviews you remembered, with one line of advice that comes from those numbers (too many new cards for what is remembered, a week with reviews but no reading, reading more or less than last week). No points and no streak: only what happened.

## [7.16.0] - 2026-11-21 - Subtitles as Something to Read
- **Films and series:** «فایل کتاب» now also takes subtitles (.srt, .vtt). Numbers, times, tags and sound notes ([music], ♪) are left out, the lines join into paragraphs, and a pause in the film starts a new one. Read the episode with everything the reader offers, make cards of its words, then watch it.

## [7.15.0] - 2026-11-21 - Listening to Your Books
- **Listening practice:** «تمرین مکالمه و آزمون» › «شنیدن» reads aloud a sentence from your books that holds a word you are learning, and you write what you hear. The sentence then comes back word by word (right, nearly, another word, left out), with a score and whether you caught your word. Hear it again, slower, or ask for a hint (your word and its meaning). The ear learns the same words the eye met in the book.

## [7.14.0] - 2026-11-21 - Learning From the Book
- **Another meaning, another card:** Tapping a word that has a card, «معنی در این جمله» shows what it means in this sentence next to your card's meaning. When it is another meaning («bank» of a river, when your card says the bank for money), «کارت تازه برای این معنی» makes a card of its own for it, instead of adding the sentence to the old card.
- **A quiz from your books:** The quiz now asks the words you are learning in the sentences of your books, with a gap and four of your own words to choose from. It needs no AI and starts at once; the AI writes questions only when your books give too few. A wrong answer counts as forgetting the word, so it comes back in your review.
- **Which book next:** In the library, books not started yet are sorted by how well they fit you, with a word on each («مناسب»، «کمی سخت»…) and «پیشنهاد برای خواندن بعدی» on the best one (for books whose words were measured on their page).
- **Memory and the week ahead:** «پیشرفت» shows how many reviews of learned cards you remembered in the last 30 days (the schedule aims at 90%), how many words you know (grown cards and the «بلدم» list) and are learning, and the reviews of the next seven days.
- **Books offline:** After each sync, the texts of chapters never opened on this device are fetched in the background, so a book added on another device can be read here without a connection.
- **Restoring a backup:** A card that comes back under a new id keeps the places in books where it was met.
- **Fix:** The quiz's "due" cards are the same as the review's.

## [7.13.0] - 2026-11-21 - Your Data, Safe
- **Full backup:** Settings › Data › «ذخیرهٔ پشتیبان» saves the whole account in one file: cards with their review schedule, the review history, books with the text of every chapter, notes, kept translations and the «بلدم» list. «برگرداندن» puts back what is missing or was deleted, and never deletes or replaces anything; a deleted card comes back with its history. (The CSV is still there, for the cards' text only.)
- **No edit lost in a long sync:** When many rows changed at once (deleting hundreds of cards, a device offline for weeks), a sync goes in rounds; a change still waiting for its round could be overwritten by another device's older copy and never sent. Now the two are merged by the server's own rule, so deleted cards no longer come back.
- **A wrong clock does not win:** A device whose clock runs ahead no longer wins every conflict; the server brings such times back to its own clock.
- **"Complete all" asks the AI less:** A card missing only a note no longer counts as incomplete, the AI is asked only for a card with no Persian meaning, a card tried in the last month is not tried again, and a wrong or missing key stops the AI for the rest of the run instead of failing on every card.
- **Sign out everywhere:** Settings › Account › «خروج از همه» signs every device out of the account (a lost phone, a shared computer).
- **Safer sign-in:** Failed sign-ins are counted per account on the server (twenty in fifteen minutes lock it for fifteen), so they no longer start again from zero on each of Vercel's servers.

## [7.12.0] - 2026-11-21 - A Lighter, More Active Review
- **New cards per day:** Today's review brings the cards you are learning first, then at most 15 new cards (Settings › Study › «کارت تازه در روز»: 5 to 50, or no cap). The rest wait for the next days, and Today says how many. Forty words saved from one chapter no longer mean forty extra reviews today and a heap three days later. «ادامه» at the end of a session still takes more.
- **Asked by how well you know it («خودکار», the default):** A new card is flipped; once you are learning it, you have to bring the word back yourself: in the book's sentence with a gap, or from its Persian meaning.
- **Persian to English:** A new review mode shows the Persian meaning; you recall the English word, then see the answer.
- **Asked once more:** A new card you answer right the first time comes back once later in the session, to be sure it was learned and not just seen.
- **"Again" comes back later:** A card you forgot comes back after ten other cards (or at the end), not after four, when the answer was still in mind.
- **Synonyms count:** In the written review, any one of the meanings on the card is right («قصد کردن» for «تصمیم گرفتن، قصد کردن»); Arabic ي/ك and the half space no longer make a right answer wrong.
- **Cramming does not fool the schedule:** Answering «خوب» or «آسان» to a card that is not due yet (a free review of all cards, a book's weakest words) leaves its schedule as it was; forgetting it still counts.
- **Fix:** Editing a section's text no longer ticks off "read today" on Today's plan.

## [7.11.0] - 2026-11-21 - Reading Without Friction
- **A tap is a quick look:** Tapping a word shows the dictionary's meaning at once and no longer asks the AI each time. «معنی در این جمله» under it asks the AI for the meaning in this very sentence; when the dictionary does not know the word, the AI is asked by itself. A structure's word («توضیح برای این جمله») works the same way.
- **Meanings kept:** The AI's meaning of a word in a sentence is kept on this device for three months: tapping it again in that sentence shows it at once, with no new request.
- **Cards only when you say so:** A looked-up word is no longer picked for a card. «+ کارت» in its sheet picks it; leaving the section asks only about the words you picked.
- **One scrolling page:** Book pages are gone; every text reads as one scrolling page per section. The type size moved to the reader's header (A A). «پایان این بخش و بعدی» goes on to the next section, and the chapter's last section ends with what was on the book's end page: how much of the next chapter you know, a review of the chapter's words, and the next chapter. Notes in the list take you to their place on the page.
- **Filling a card again in one step:** Editing a card, «گذاشتن و ذخیرهٔ کارت» puts the picked suggestions in the card and saves it; a second «ذخیره» is no longer needed. (A new card is only filled, as before.)

## [7.10.0] - 2026-10-31 - Delete the Cards You Choose
- **Choose cards to delete:** On the cards page, «انتخاب» puts a box beside each card; tick the ones you want gone (or a whole page at once) and press «حذف». Only cards in the list as it is filtered now are deleted.
- **Always asked first:** Deleting one card or many opens a window that names the cards and how many, with «انصراف» chosen by default; nothing is deleted until you press the red button. The trash button on each card, which used to delete at once, now asks too.
- **Delete from the card form:** Editing a card has «حذف کارت», with the same question (not while editing from inside a review).
- **Everywhere:** A deleted card goes from all your devices with the next sync; books, notes and other cards stay.

## [7.9.0] - 2026-10-28 - No More Points: The App Is About Reading
- **Game parts removed:** Points, levels, the day streak and its shields, combos, badges, daily goals, confetti and reward chests are gone for good, with the setting that brought them back. Progress is what you read and learned («پیشرفت»). Old points and badges stay untouched in your account, unused.
- **Words page:** The level, streak and goals box at the top of the word list is gone.
- **Faster start:** The app's main file is a third of its size (810 kB → 265 kB): every screen but Today loads when first opened, and the reader and the review are fetched at once in the background so they open offline. React and the database library sit in a file of their own, so an update of the app no longer makes the phone download them again.
- **Fixes:** The word list no longer changes state while drawing (going back to page 1 when the filters change); the reading-aloud voice you picked is kept when the browser's voices arrive late; the app's start-up and sync listeners always use the newest code. In development mode a tapped word's meaning could stay "searching…" for ever.
- **Review end screen:** It no longer touches the top of the screen.

## [7.8.0] - 2026-10-27 - Reading First: Calm Mode, Meanings in the Margin, Your Words in Telegram
- **Your words in Telegram:** Every day 5 to 10 of your cards come to Telegram, about 8 in the morning: the word in the sentence of the book it was met in, the meaning one tap away, then «دوباره / سخت / خوب / آسان» as in the app. The answers reach your account and every device; "Again" brings the word back at the end of the day's list. In the bot, /review starts a review any time, /stop and /resume turn the daily one off and on. Link it once in Settings › Telegram and pick how many words a day. (The server needs `TELEGRAM_BOT_TOKEN` from @BotFather, and `CRON_SECRET` for the daily message on Vercel.)
- **Calm mode, by default:** Points, levels, the streak and its shields, combos, badges, confetti and reward chests are hidden; nothing is deleted, and Settings › «امتیاز، سطح، زنجیره و نشان‌ها» brings them back. Today starts with your book; a chapter is a table of contents with the minutes each section takes; a review ends with the words you now know better and the ones still hard, with the book each came from.
- **Plain stage names:** «تازه، آغاز یادگیری، در حال یادگیری، آشنا، بلدم» instead of seed, sprout, sapling, tree and rooted.
- **Meanings in the margin:** While reading, a word whose card is new has its short meaning written small above it, from your own card, once per section; it goes away by itself as you learn the word (Settings: new words, until familiar, or off).
- **What happened so far:** Opening a book after two days or more shows a short reminder of the pages you read last: a summary in simple English and Persian with AI, else the last lines you read.
- **Reading time and pace:** Active reading time is kept per book and per day (a book left open on the table does not count) and syncs. The book page shows minutes read, your words per minute and the time to the end; the reader's footer shows the minutes to the end of the chapter, at your own pace.
- **The next chapter, measured:** The end of a chapter says how much of the next one you already know («۹۳٪ واژه‌های فصل بعد را می‌شناسی») and how many new words to expect in each section.
- **Book reviews in the book's sentences:** Reviewing a book, a chapter or the section just read now asks each word in a sentence of the book, with a gap to fill; flipping cards is the other button.
- **A paragraph in Persian from a word:** The sheet of a tapped word has «ترجمهٔ پاراگراف», which translates its whole paragraph (in book pages too).
- **Open on the book:** An option opens the app on the page where you stopped, instead of Today.
- **Progress that means something:** «پیشرفت» shows minutes read, chapters and books finished, words read, the words with cards you met again in books, reading minutes per day, a year of reading day by day, and for each book how far you are, your pace and how much of its words you know.

## [7.7.0] - 2026-10-27 - Your Own Cards While Reading, a Plan for the Day, a Book's Notes
- **Your card, in the book:** Tapping a word that already has a card now shows what your card says (its meaning, notes and how well you know it) at once, also offline. It used to look the word up in a dictionary as if it were new, so it showed another meaning, or nothing when the dictionary could not be reached.
- **…and in the review:** In a card's sentences during a review, words that have a card of their own are underlined with dots; a tap shows that card's meaning.
- **Today's plan:** The Today screen starts with a short plan: the next section of your book, the cards due, and the sentences due for pronunciation, each with about how many minutes it takes and one tap to start. Parts done today are ticked off.
- **A book's notes:** A new tab «یادداشت‌ها» on a book lists every note and kept translation in reading order, each a tap away from its place in the text. Copy them, or save them as a Markdown file.
- **Fairer review schedule:** "Again" brings a card back in 10 minutes, the same day, instead of tomorrow. Days between reviews are counted on the calendar, not in 24-hour spans (a card seen at night and again next morning was seen a day later). Only forgetting a learned card counts as a lapse, once a day, so one bad session no longer makes a card "stubborn".
- **A failed save:** If saving an answer fails during a review, the app says so and the card can be answered again; before, the session stopped taking answers.
- **No endless waiting:** A request to the server that gets no answer gives up after 25 seconds (70 for AI, sync and uploads), so a dead connection no longer leaves a screen waiting for ever.
- **Offline start:** The offline copy no longer drops the app's main files when it trims old ones, so the app keeps opening without a connection.
- **"Complete all cards":** Filling empty parts of many cards no longer undoes a review or an edit made while it runs: only parts still empty are filled.
- **Server data file:** When saving the data file fails, the server's memory goes back to what is on disk, so nothing looks saved that is not.

## [7.6.0] - 2026-10-16 - Reading Like a Book: Pages, Your Own Text, Notes and Kept Translations
- **Pages:** Books now open as pages that fill the screen, with nothing around them but a thin bar: one page on a phone, two facing pages with a spine on a wide screen. Turn pages by swiping, by tapping the edge of the page, or with the arrow keys; the footer shows the page and how far into the chapter you are. The old scrolling page is still there (Aa › continuous).
- **One continuous book:** Turning past the last page of a section finishes it (the same XP and progress as before) and the next section follows; paging back from the first page opens the previous section on its last page. A chapter ends on a page of its own, with a review of its words and the next chapter.
- **The page as you like it:** Type size (the place on the page is kept when it changes), cream, white or night paper, justified text, and paragraphs indented as in print. Punctuation no longer starts a line. Reading aloud starts from the page in view and turns the pages as it goes; where you stopped on the page is kept on the device.
- **Edit the text:** Correct a section's text, cut out a paragraph that does not belong (page numbers, footnotes), or empty a whole section, which reading then passes over without a reward. The edited text reaches every device; a device with the old copy fetches the new one.
- **Notes:** Write a note on a word, a phrase or a passage (pick it, then ✎). Noted words are green; a tap opens the note to read, edit or delete it, and still offers the word's meaning.
- **Kept translations:** A sentence's or a whole paragraph's translation can be saved («ترجمهٔ کل پاراگراف», then «ذخیرهٔ این ترجمه»). Its words turn blue and a tap shows it; in the scrolling page it shows under its paragraph every time.
- **Your notes, everywhere:** Notes and kept translations sync between devices, are found again after the text is edited, and are listed per chapter (in «واژه‌ها»), each taking you to its place in the book.

## [7.5.1] - 2026-10-16 - Claude Models, and a Listener That Really Hears
- **Claude:** Newer Claude models refused every request ("`temperature` is deprecated for this model"); the app no longer sends a temperature to Claude.
- **A listener that did not hear:** When the listener answers without having heard a recording that has a voice in it (it heard nothing, or wrote about the recording itself, like "leaked audio" or "[inaudible]"), the answer is not saved as a score. The same recording can be sent again with one tap, and after two such answers the app suggests another listener.
- **Quiet recordings:** A quiet recording (a phone held far away) is made up to ten times louder before it is sent; a recording with no voice in it is not sent at all, and the app says to hold the phone closer. The listener is also told to leave "heard" empty rather than guess words from noise.
- **Wrong tries:** A try can be deleted from the pronunciation history, so a wrong score does not stay in the progress or the review schedule.

## [7.5.0] - 2026-10-16 - Claude, and Another Listener for Pronunciation
- **Claude (Anthropic):** A new AI service in Settings, with its own key and the list of Claude models to pick from. It can be put anywhere in the order of services and does everything the other text services do (finding words, meanings, grammar, checks, quizzes). It cannot hear, so it is never asked in pronunciation practice.
- **Pronunciation through OpenRouter:** Pronunciation practice is no longer tied to Gemini. In Settings › Study, its listener is Gemini, an OpenRouter model that takes audio (Gemini Flash by default; the list shows only models that hear), or Gemini first and OpenRouter when Gemini fails. Recordings are sent as WAV, which every such model takes. Each try says which service and model listened.
- **Fairer scores:** The AI now writes down what was said word for word, without correcting it, and the app lines it up with the sentence itself: a word left out or said as another word is marked even when the AI did not mark it, completeness is counted from it, and the score cannot stand far above what was actually read. A different word altogether no longer scores well in word practice.
- **Clearer failures:** When the listener fails, the message says why and where to set up another one. A service that refuses the server for its region or for sanctions (Google's "User location is not supported", OpenRouter's "Access denied by security policy") is reported as that, not as a wrong key. Pronunciation feedback on the card form is in Persian and works with Safari's recordings.

## [7.4.0] - 2026-10-16 - Safer Sign-out, Versions and Pronunciation in Sentences
- **Accounts:** Signing out first sends what changed on this browser and warns if something could not reach the server. When another account signs in on the same browser, the previous account's cards are cleared from it first; before, they were uploaded into the new account.
- **Security:** Article links written as an IPv6 address (`[::ffff:127.0.0.1]` and the like) can no longer reach the server itself or its network.
- **Security:** The base URL of a custom AI service must be a public address, and its redirects are not followed. A VPS running its own Ollama allows private addresses with `ALLOW_PRIVATE_AI_URL=true`.
- **Versions:** The version in Settings and the changes page are read from this file, so they always match what is installed; the page lists every release with its date. After an update the app says once which version arrived.
- **Pronunciation in sentences:** A word is now practised inside the sentence it was met in (from the book first, then the card's own sentence or example; a long one is cut around the word). The word is underlined, its meaning is a tap away, and the sentence can be heard first, slowly, or the word alone.
- **Feedback on the whole sentence:** The sentence comes back word by word in colour (right, unclear, wrong, left out) with what each wrong word sounded like, four part scores (sounds, fluency, stress and rhythm, completeness), a separate score for the card's word, and one thing to do on the next try.
- **Pronunciation that comes back:** Each item has its own review schedule, worked out from its tries: the first try of a day decides it; a weak one comes back the next day, a good one after 3, 7, 16 and 35 days, and three good days in a row make it settled. Today's plan takes the items due first, then a couple of new ones; a try below 60 is asked once more at the end of the same session.
- **Practice history:** The progress page shows learning, settling and settled items, what is due today, and every try with its marked sentence; a session ends with each item's first and last score and when it comes back.

## [7.3.0] - 2026-10-11 - Reading Aloud and Pronunciation Feedback
- **Read aloud:** A section can be read aloud by the device voice or an AI voice (Gemini or OpenRouter speech models), goes on from where it was paused, and a paragraph can be translated. AI audio is kept on the device.
- **Pronunciation:** Practice names the sounds that went wrong, keeps every try with the AI's feedback (synced between devices) and shows progress by day and the weakest cards.
- **Improve cards with AI:** Pick the parts to fill (empty only, or rewrite), the service and how many cards, then tick the changes to keep. A new reference part explains historical and literary allusions.
- **Cards page:** Says what the fill buttons use and that they only fill empty parts, and asks before filling all.

## [7.2.0] - 2026-10-10 - Richer Cards, Dictionaries and Keys on Every Device
- **Keys:** AI and dictionary keys follow the account, encrypted on the server, so a key typed once works on every device; they leave the browser on sign-out.
- **Richer cards:** Synonyms with how they differ, a common mistake, register, word family and root, and fresh help for stubborn cards. A card can be refilled from a chosen AI service or dictionary with a preview, and edited from any screen.
- **Dictionaries:** Set up in Settings like the AI services, in the order you choose; idioms, collocations, expressions and slang become their own kinds of card.
- **AI models:** Picked from each service's own list, and a token report by day, week and month.
- **Reliability:** The browser database and sync say why they failed and offer a repair; every browser starts afresh once; sign-in errors show on the sign-in screen; a 500 on every request on Vercel was fixed.

## [7.1.0] - 2026-10-09 - Books: Reviews, Difficulty and Progress
- **Review by book:** Each book and chapter reviews its own cards (due ones first, else the weakest); a chapter's hard words can be pre-studied before reading it.
- **Gap in the sentence:** A new review mode («جای خالی») leaves the word out of the book's sentence; a typo or another form counts as close.
- **Difficulty:** A book's page shows how many of its words you know, new words per section and the text's level, measured once with a 400-word sample.
- **Bookshelf and rewards:** The library is a shelf (reading, not started, finished); finishing a chapter or book gives extra XP and badges; reading counts toward the daily goal.
- **Stats:** Rewritten in Persian, with each book's words over time and the hardest words to review.
- **Persian everywhere:** Decks, the word list, the card form, bulk add, review setup, badges, profile and all messages.

## [7.0.0] - 2026-10-09 - Library, Reading Mode and Checks
- **Library:** Books (EPUB), articles (a link) and texts in one library, read section by section, with the place every card came from and which service made it.
- **Reading:** A tap gives the meaning in the sentence; drag over words for a phrase or a sentence (meaning, grammar, translation); «بلدم» takes a word off the suggestions for good; words are underlined by how well you know them; a section's hard words can be shown before reading it.
- **AI services:** Several services in the order you choose, each with its own key; when one fails the next is asked, then the free dictionaries. A usage page shows requests, failures, cards per service, the free translation quota and data size.
- **Checks:** Word levels (A1 to C2); a «بررسی» tab per book for cards the dictionary did not know, without a Persian meaning, or not in their sentence; an AI meaning check of 20 cards at a time whose suggestions you accept or keep.
- **Grammar:** About 20 structures found by the app's own rules and underlined while reading, each with a built-in Persian explanation and exercise; reviewing a grammar card asks for your own sentence, checked by the rules and, with AI, explained, with a suggested rating.
- **Settings:** Now in Persian.
- **Matching:** A card's term is found in a text without its placeholders («take something into account» finds «took the cost into account») and in irregular plurals («children» for «child»).

## [6.0.0] - 2026-10-08 - New Look: Today Screen, Reading Path & Fairer Rewards
- **Design:** A Persian, right-to-left interface with the Vazirmatn font; English words and texts stay left-to-right. Older screens (decks, card list, settings, stats, practice) keep their English layout inside the new frame.
- **Design:** On a computer a side menu lists every section (Today, Review, Practice, Texts, Words, Stats, Settings) with quick-add buttons and the sync status. On a phone there are four tabs (Today, Texts, Words, Me) and an add button.
- **Feature:** The Today screen is the new home: a daily goal ring with one Start Review button for all due cards, typing and practice shortcuts, this week's streak days, a "word garden" of mastery stages, and the text you are reading.
- **Feature:** The review screen shows the word, its pronunciation and your source sentence, then the meaning, expressions, definitions and examples on the same card. Each of the four FSRS buttons shows when the card comes back. Keyboard: Space shows the answer, 1-4 rate, P plays, Z undoes the last answer, Esc ends.
- **Feature:** A session summary shows XP, first-try accuracy, time, your streak and the words that moved up a stage, with "10 more cards" and confetti when the daily goal is reached.
- **Feature:** Texts are kept as a path of 300-word sections. Each section opens in a reader where you find its hard words (AI or free dictionaries), tap any word to look it up, make cards into the text's deck, and finish the section. Texts sync like cards. The one-shot extractor is still there as "استخراج یکجا".
- **Gamification:** XP now comes from reviews (more for a correct answer, plus a bonus for 5 right in a row) and from finishing text sections, not from adding cards. The daily goal is a fixed number of reviews you choose in Settings (default 20) instead of random goals.
- **Gamification:** Streak freezes: every third finished section gives one (you can hold two), and a freeze covers a missed day automatically so the streak survives.
- **Words:** Each card has a mastery stage from its FSRS stability: seed, sprout, sapling, tree, rooted.

## [5.4.0] - 2026-10-08 - FSRS Scheduling
- **Feature:** Reviews are now scheduled with FSRS-5, which tracks how well you know each card (stability and difficulty) and shows it again just before you are likely to forget it, aiming for 90% recall. It needs noticeably fewer reviews than the old SM-2 rule for the same retention.
- **Feature:** A fourth answer button, **Hard**, sits between Again and Good. Each button shows when the card will come back (for example `3d`, `2mo`).
- **Improvement:** Existing cards keep their schedule: their current interval and easiness are converted to FSRS the first time you review them.
- **Fix:** A card answered "Again" and repeated in the same session now continues from that answer instead of being scored twice from its old state.

## [5.3.0] - 2026-10-08 - Long Texts, Richer Cards & Free Dictionary Mode
- **Feature:** Long texts are split into sections of at most 300 words on sentence boundaries; each section is analysed on its own with a progress bar and a Stop button, and the results are merged without repeats.
- **Feature:** Terms that already have a card are excluded from the AI request and flagged ("قبلاً کارت دارد") instead of being added again.
- **Feature:** Cards now keep the exact sentence of your text, 3-5 common expressions that use the term (each with a listen button), a type (word, phrase, idiom, grammar) and, for grammar structures, the pattern and a sentence-building exercise. Every sentence and expression on a study card can be read aloud.
- **Feature:** "Free dictionaries" extraction works without AI: hard words are chosen by word frequency for your level, phrasal verbs are kept when a dictionary knows them, and meaning, IPA, audio, Persian translation (MyMemory) and common expressions (Datamuse) are fetched for each. If AI fails for a section, that section falls back to this mode automatically.
- **Fix:** A failed AI translation no longer saves "Could not generate translation." onto the card; "Complete card" now uses your AI settings and falls back to a free translation, and also adds common expressions.
- **Fix:** The Express server crashed on start in production mode (`app.get('*')` is invalid in Express 5).

## [5.2.1] - Secure Cloud Sync
- **Security:** Cloud sync now needs a real sign-in. The server sets a signed, HttpOnly session cookie at login, and sync only reads or writes the signed-in account. Before, anyone who knew a username could read or overwrite its cards.
- **Security:** Passwords are stored as scrypt hashes. Existing plain-text passwords are converted the next time you sign in.
- **Security:** Five wrong passwords lock that username from that address for 15 minutes.
- **Security:** The audio proxy only fetches from known dictionary hosts, and the API no longer accepts calls from other websites.
- **Setting:** `ALLOW_REGISTRATION=false` closes sign-up once your account exists. Everyone has to sign in once after this update.

## [5.2.0] - Auto-Fix Reporting & Stability Fixes
- **Feature:** Added a detailed report summary after the "Auto-Fix All" process completes. You can now see exactly how many cards were updated and what specific information (Audio, Definitions, Translations, etc.) was added to your collection.
- **Fix:** Resolved a critical issue where cards updated via "Auto-Fix" would revert to their previous state after a few moments. This was caused by a race condition in the background synchronization process, which has now been fixed by pausing sync during intensive operations and improving the data merge strategy.

## [5.1.1] - Improved Study Logic & Stats Redesign
- **Fix:** Refined the "New Cards" filter logic for study sessions. Previously, cards marked as forgotten ("Again") were incorrectly included in the "New Cards" list. The filter now ensures only truly new cards (never successfully reviewed) are shown.
- **Feature:** Redesigned the "Stats" page. The 90-day heatmap has been replaced with a cleaner, more intuitive "Weekly Activity" bar chart, giving you a clearer view of your recent study habits.

## [5.1.0] - Auto-Fix All Feature
- **New Feature:** Added a "Magic Wand" button to the "All Cards" list. With a single click, the app now scans your entire collection for incomplete cards (missing audio, definitions, translations, etc.) and automatically fetches the missing details.
- **Improvement:** This process runs intelligently in the background, skipping cards that are already complete to save time and data. A progress indicator allows you to monitor the operation, and a "Stop" button provides control if you wish to pause.

## [5.0.9] - Bulk Add Stability Fix
- **Fix:** Resolved a race condition in the Bulk Add feature where manual edits to a card's translation or notes could be overwritten by a delayed AI response. The app now respects your inputs and will not overwrite existing content with AI suggestions.
- **Fix:** Fixed an issue where the edit form in Bulk Add would reset while typing if other parts of the card (like audio) finished loading in the background.

## [5.0.8] - Daily Goals Stability Fix
- **Fix:** Resolved a critical bug where "Today's Goals" charts would disappear or reset immediately after a practice session. This was caused by a conflict between the server's UTC time and the user's local timezone, leading the app to incorrectly believe it was already "tomorrow" during evening usage. The app now correctly uses your local date for tracking daily progress.

## [5.0.7] - Accessibility & Bandwidth Optimization
- **Accessibility Fix:** Resolved an accessibility issue in the login/registration form where input fields were not associated with their labels. This improves the experience for users relying on screen readers.
- **Optimization:** Pronunciation audio files fetched from dictionaries are now cached on the Edge network for 24 hours. This significantly reduces bandwidth usage and speeds up playback for frequently accessed words.

## [5.0.6] - Reliability Improvements
- **Fix:** Addressed a potential crash in the "Practice" mode caused by an undefined variable when shuffling cards.
- **Improvement:** The "Bulk Add" feature now provides clearer feedback when the dictionary service times out, distinguishing it from other network errors.

## [5.0.5] - Stability & UX Fixes
- **Fix:** Improved error handling in "Practice" mode. If the AI service fails to generate a quiz, a user-friendly message is now shown on the screen instead of a disruptive system alert.
- **Fix:** Resolved a Service Worker registration error that could cause a 404 error in the browser console and prevent offline capabilities from working correctly.

## [5.0.4] - Practice Mode Reliability Fix
- **Fix:** Resolved a critical issue where the AI-powered "Practice" mode would frequently fail or time out. The quiz size has been reduced from 10 to 5 questions to create a lighter, faster API request.
- **Improvement:** Added validation to ensure only cards with valid English words are used to generate quizzes, preventing errors and improving stability.

## [5.0.3] - Data Persistence Fix
- **Fix:** Resolved a critical data loss bug where recent edits to a flashcard could be overwritten by an automated cloud sync. A new timestamp-based sync logic has been implemented. Now, when syncing, the app compares the local and cloud versions of a card and always keeps the one that was most recently updated, ensuring no work is ever lost.

## [5.0.2] - Practice Mode Fix
- **Fix:** Resolved a major issue where the "Practice" feature would not work if the user had fewer than 4 "new" cards. The quiz generation logic is now more flexible, prioritizing new cards, then falling back to cards due for review, and finally using any available cards to ensure the feature is always accessible.

## [5.0.1] - Concurrency Fix & UI Polish
- **Fix:** Resolved a critical data integrity bug in the "All Cards" list where making rapid, consecutive changes to different cards could cause previous updates to be reverted. The inline completion logic now fetches the latest card data directly from the database to prevent race conditions.
- **UI/UX:** The loading spinner on the inline "Complete Card" button is now centered and more visually stable during the update process.

## [5.0.0] - "All Cards" Page Overhaul
- **Feature:** Added advanced sorting options to the "All Cards" list. Users can now sort by English (A-Z, Z-A), Persian (A-Z, Z-A), latest added, and cards that are missing audio.
- **Feature:** Implemented pagination for the "All Cards" list, displaying 100 cards per page to improve performance and usability for large collections.
- **Feature:** Introduced an inline "Complete Card" feature. Cards with missing information (audio, definition, etc.) now show visual indicators. A new "magic wand" button allows users to automatically fetch all missing details for a single card using AI and dictionary APIs directly from the list view, without needing to open the editor.
- **Improvement:** Added a `createdAt` timestamp to all new cards to enable more accurate sorting by "latest". A database migration ensures older cards have a fallback creation date.
