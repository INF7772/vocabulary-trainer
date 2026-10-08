# Claude for Startups application pack

## Product name

Vocabulary Trainer

## One-line description

Vocabulary Trainer turns a learner's own vocabulary and media into structured,
multimodal practice that adapts to mistakes and works offline.

## Short application description

Vocabulary Trainer is a local-first language-learning application for people
who want to learn vocabulary from their own materials rather than a fixed
course. Each word is trained as several independent skills—meaning-to-word,
word-to-image, audio recognition, strict typing, and speed—while mistakes return
after intervening tasks until recall becomes reliable. The working early alpha
already includes lesson authoring, reusable cards, image and audio support,
three-stage learning, targeted practice, an FSRS review queue, offline storage,
portable lesson files, and a Windows build.

Claude is the next authoring layer: it will turn rough learner-provided word
lists into concise definitions, natural example contexts, and plausible
distractors, and help explain recurring mistakes. The learning engine and
personal progress remain local; Claude is used where language understanding and
content generation add clear value. The product is bootstrapped and currently
in early alpha.

## 30-second pitch

Most flashcard tools treat knowing a word as one binary event. Vocabulary
Trainer separates vocabulary into the skills people actually need: recognizing
meaning, understanding sound and images, producing the exact word, and recalling
it quickly. Learners bring their own material, and the app automatically
reshuffles mistakes into later tasks. The core product already works offline;
Claude will remove the slowest part—turning a rough list into high-quality,
contextual learning material.

## Problem

Existing tools often offer either a fixed curriculum or a generic flashcard
loop. Learners who collect vocabulary from work, books, videos, travel, or a
specific hobby still need to assemble translations, examples, images, audio,
and useful distractors by hand. A card can also feel familiar while the learner
still cannot recall or type the word independently.

## Solution

Vocabulary Trainer gives learners ownership of the material and trains each
card across distinct recall modes. Delayed retries and targeted practice keep
errors active without resetting the entire lesson. All core data remains local,
and lesson packages are portable.

## Current working product

- Local-first React/TypeScript PWA and portable Windows build
- Ten interface languages and arbitrary target/translation language pairs
- Lesson creation, editing, import, export, and full local backup
- Images, uploaded/recorded audio, system speech, and optional offline voices
- Three-stage Learn flow with delayed error retries
- Review queue, difficult-card markers, global statistics, and FSRS scheduling
- Custom practice, strict typing, quick choice, Chaos matching, and handwriting
  practice for symbol lessons
- Built-in offline demo lesson with images and audio

## Claude integration plan

The first Claude-powered slice is intentionally narrow and measurable:

1. The learner pastes a list of words or short phrases.
2. Claude proposes concise meanings, one natural example for each item, and
   plausible same-language distractors.
3. The learner reviews the generated material before it becomes a local lesson.
4. Repeated error patterns can later be summarized into focused follow-up
   exercises without uploading the complete learning history.

This is a roadmap item, not presented as part of the current working alpha.

## Suggested evaluator demo (60–90 seconds)

1. Open the app and point out the built-in `Everyday English · Demo` lesson.
2. Open the lesson to show local images, audio, progress, and portable status.
3. Start Learn and complete one multiple-choice question.
4. Deliberately choose one wrong answer, then show that the card returns later.
5. Open Practice Builder and show lesson combination, filters, ordering, and
   strict typing/audio formats.
6. Close with the local-first architecture and the clearly scoped Claude
   authoring roadmap.

## Honest early-alpha disclosure

Core learning, authoring, practice, portability, and offline behavior are
functional. Authoring polish, voice-package management, onboarding, and the
Claude-assisted creation flow are still under active development. There are no
claimed user, revenue, or growth metrics yet.

## Prepared links

- Product site: `https://inf7772.github.io/vocabulary-trainer/`
- Source repository: `https://github.com/INF7772/vocabulary-trainer`
- Windows alpha: `https://github.com/INF7772/vocabulary-trainer/releases/download/v0.9.0-alpha.1/Vocabulary-Trainer-0.9.0-alpha.1-portable.exe`
