Ты работаешь как автономный senior product engineer / frontend engineer.

Твоя задача — НЕ описать приложение, НЕ сделать mockup и НЕ ограничиться архитектурным планом. Нужно непосредственно в текущем workspace разработать полностью рабочую production-quality первую версию приложения согласно спецификации ниже.

Не задавай мне уточняющих вопросов, если решение уже можно разумно вывести из спецификации. Если встречается техническая неоднозначность, выбирай самое простое надёжное решение, которое сохраняет описанную продуктовую механику.

Не останавливайся после генерации кода. Установи зависимости, запусти приложение, typecheck, lint, unit tests, E2E tests и production build. Исправляй найденные ошибки до тех пор, пока основной продуктовый workflow не работает.

Не добавляй функции, которых нет в спецификации, просто потому что они типичны для языковых приложений.

1. PRODUCT OVERVIEW

Рабочее название приложения:

Vocabulary Trainer

Название должно храниться централизованно, чтобы потом его было легко поменять.

Это local-first PWA для интенсивного изучения и автоматизации иностранной лексики.

Приложение НЕ является языковым курсом.

Пользователь получает лексику из внешнего источника:

учебника;

языкового курса;

Irodori;

урока;

преподавателя;

собственного списка.

После этого пользователь быстро создаёт в Vocabulary Trainer урок и изучает эти слова.

Главная задача продукта:

максимально быстро превратить список иностранных слов в устойчивую связь

MEANING ↔ FOREIGN WORD ↔ AUDIO

с помощью повторения, ручного ввода, ошибок, скорости и игровых упражнений.

2. ОСНОВНАЯ ФИЛОСОФИЯ

Картинка и перевод НИКОГДА не рассматриваются как два независимых типа информации.

Они всегда образуют единую смысловую сущность:

Meaning Block

Например:

┌───────────────────────┐
│                       │
│      [BOOK IMAGE]     │
│                       │
│        книга          │
│                       │
└───────────────────────┘

Meaning Block имеет два корректных представления:

если изображения включены и Card имеет image — IMAGE + SELECTED TRANSLATIONS;

если изображения отключены или Card не имеет image — SELECTED TRANSLATIONS.

Картинка без перевода не используется в упражнениях.

Перевод без картинки является полноценным Meaning Block.

Иностранное слово является второй стороной связи.

Например:

本

Audio является обязательной частью каждой карточки, но может обеспечиваться custom audio, подходящим system voice или поддерживаемым application TTS provider.

Общая модель:

[OPTIONAL IMAGE + ONE OR MORE TRANSLATIONS] ↔ FOREIGN WORD ↔ AUDIO

3. ЧЕГО В ПРИЛОЖЕНИИ НЕ ДОЛЖНО БЫТЬ

Не реализовывать:

аккаунты;

регистрацию;

backend;

облачную базу;

подписки;

рекламу;

виртуальную валюту;

hearts / energy;

streak;

XP;

leaderboard;

друзей;

social feed;

marketplace;

AI tutor;

chatbot;

встроенный языковой курс;

встроенный готовый курс грамматики.

Приложение планирует повторение выученных Cards через FSRS и формирует ежедневную очередь «Сегодня». Это локальное расписание обучения, а не геймифицированные ежедневные задания.

4. TECH STACK

Используй современный, поддерживаемый stack:

React

TypeScript

Vite

Tailwind CSS

IndexedDB

Dexie

PWA

Service Worker

Web Speech API / SpeechSynthesis

MediaRecorder API для пользовательской записи audio

i18n

Vitest

React Testing Library

Playwright

Для PWA можно использовать подходящий поддерживаемый Vite PWA plugin.

Не использовать backend.

Основной learning workflow должен работать offline после загрузки приложения.

Функции автоматического перевода и поиска картинок могут требовать интернет и должны быть progressive enhancement.

5. DATA MODEL

Не делай Card дочерней сущностью Lesson.

Карточки должны существовать глобально.

Одна Card может находиться в нескольких Lessons.

Это важно, потому что пользователь должен иметь возможность выбрать сложные слова из нескольких уроков и создать из них новый Lesson без дублирования карточек.

Card

Минимальные поля:

id

target

pronunciationText optional

targetLanguage

translations

image optional

imageMetadata optional

customAudio optional

createdAt

updatedAt

Translations должны быть структурой по языкам.

Например:

translations = {
ru: "книга",
de: "Buch",
en: "book"
}

Lesson

id

name

targetLanguage

translationLanguages[]

activeTranslationLanguage

visibleTranslationLanguages[]

createdAt

updatedAt

LessonMembership

Связывает Card и Lesson.

LessonProgress

Хранит состояние обучения карточки именно внутри конкретного Lesson:

learned

current learning state if needed

Global Card Statistics

Статистика должна принадлежать Card глобально, а не конкретному Lesson.

Минимально хранить:

correctCount

errorCount

totalCompletedQuestions

totalResponseTimeMs

averageResponseTimeMs

Accuracy вычислять:

accuracy =
correctCount /
(correctCount + errorCount)
× 100

Если данных нет — показывать нейтральное состояние, а не 0% как будто пользователь всё знает неправильно.

6. UI LANGUAGE И TRANSLATION LANGUAGE — РАЗНЫЕ ВЕЩИ

Разделять:

Interface Language

Язык интерфейса приложения.

Например:

English

Russian

German

Spanish

Минимально локализуй UI на эти четыре языка.

Архитектура должна позволять легко добавлять следующие языки.

Translation Languages

Языки, через которые пользователь понимает иностранную лексику.

Пример:

пользователь знает:

Russian

German

English

и изучает Japanese.

Карточка:

target:
本

translations:

ru: книга

de: Buch

en: book

Пользователь выбирает primary Active Translation Language и один или несколько Visible Translation Languages.

Во время конкретной тренировки Meaning Block одновременно показывает все выбранные visible translations. Active Translation Language всегда входит в visible list и остаётся primary для настроек и совместимости.

Например при Russian:

[IMAGE]

книга

При German:

[IMAGE]

Buch

Пользователь может оставить один перевод или включить несколько, например Russian + English + German. Каждый перевод имеет короткую language label, чтобы значения не смешивались.

Переключение translation language не сбрасывает статистику.

7. MISSING TRANSLATION

Если пользователь включил German в visibleTranslationLanguages, но некоторые карточки Lesson не имеют немецкого перевода:

НЕ делай молчаливый fallback прямо в упражнении.

До начала тренировки показать понятное сообщение:

"3 cards are missing German translations."

Показать эти карточки.

Дать кнопку:

"Fix cards"

Тренировка может начинаться, когда все используемые карточки имеют:

all visible translations;

working audio source из custom audio, подходящего system TTS или включённого application fallback provider.

Image не является readiness requirement независимо от настройки отображения изображений.

8. AUDIO

Audio существует для КАЖДОГО слова.

Приоритет источников:

customAudio;

подходящий по locale system TTS для pronunciationText или target;

application TTS fallback provider, если он поддерживает язык и пользователь разрешил загрузку его assets;

понятное unavailable state.

То есть:

custom audio exists
→ использовать его.

Если pronunciationText существует, выбранный provider произносит pronunciationText; иначе — target.

Нельзя использовать системный default voice другого языка как fallback.

Пример:

target:
今日

pronunciationText:
きょう

TTS должен произносить:

きょう

9. TTS SETTINGS

У Lesson / target language должны быть:

target locale;

выбранный системный voice;

speech rate;

preview button.

Показывай пользователю доступные voices подходящего языка.

Если подходящего системного TTS voice нет:

покажи понятное предупреждение.

Пользователь должен иметь возможность включить поддерживаемый application fallback provider или добавить custom audio.

TTS реализуется через generic provider boundary. Japanese browser fallback выполняется полностью client-side, загружается только после явного подтверждения пользователя, показывает размер/состояние загрузки и не требует Windows speech pack, backend, API key или платного API.

Перед новым TTS playback вызывай cancel предыдущей очереди, чтобы быстрые нажатия не создавали длинную очередь звуков.

10. CUSTOM AUDIO

В редакторе Card:

Audio:

Play current audio

Record audio

Upload audio

Reset to system TTS

Record audio использует MediaRecorder и microphone permission.

После записи пользователь должен иметь возможность:

прослушать;

перезаписать;

сохранить;

удалить.

Custom audio полностью заменяет TTS для этой карточки, пока пользователь его не удалит/reset.

11. IMAGE

Image является optional enhancement. Card без изображения полноценна и может использоваться в Learn/Automate.

Global Settings содержит `useImages` default; Lesson может сохранить свой override. При выключенных изображениях Meaning Block показывает все выбранные visible translations. При включённых изображениях Card с image показывает image + visible translations, а Card без image корректно показывает translation-only block и не падает.

Поддержать:

file picker;

drag & drop;

paste image from clipboard;

automatic image suggestions.

При добавлении больших пользовательских изображений оптимизировать их перед сохранением.

Не хранить многомегабайтные оригиналы без необходимости.

Разумно уменьшать изображение до примерно 1024 px по большей стороне и использовать эффективный web-compatible формат.

Не разрушать изображения с прозрачностью.

12. AUTOMATIC IMAGE SEARCH

Попытайся реализовать бесплатное автоматическое предложение картинок через Wikimedia Commons / MediaWiki API.

Это optional network enhancement.

Никаких платных API.

Алгоритм:

Card имеет target и translations.

Для image search предпочитать:

English translation, если она существует;

active translation;

target.

Получить несколько подходящих image candidates.

Можно автоматически выбрать лучший/top result как начальное изображение, но пользователь всегда может его заменить.

После массового создания карточек обязательно показать Review Cards screen.

Для Wikimedia изображения сохранять доступные metadata:

source URL

author if available

license if available

Не добавлять отдельный prominent Image Credits navigation item. Attribution metadata хранится и переносится, а источник/автор/лицензия показываются контекстно в Card editor/details.

13. AUTOMATIC TRANSLATION

Главный желаемый workflow:

пользователь вводит только список иностранных слов.

Например:

私
これ
本

Приложение пытается автоматически заполнить выбранные translation languages.

Не использовать платные translation API.

Если browser built-in Translator API доступен — использовать его как progressive enhancement.

Показывать состояние:

checking availability;

model downloading if browser требует;

translating;

finished;

unavailable.

Все auto translations должны быть editable.

Если automatic translation недоступен:

не ломать создание Lesson.

Перейти на manual translation import.

14. MANUAL TRANSLATION IMPORT

Пользователь вставляет список переводов в том же порядке строк.

Иностранные слова:

私
これ
本

Russian:

я
это
книга

German:

ich
dies
Buch

English:

I
this
book

Приложение связывает строки по индексу.

Количество строк должно совпадать.

Если не совпадает — показать validation error и preview.

Не импортировать данные в неправильные карточки.

15. LESSON CREATION WORKFLOW

Основной Create Lesson wizard:

Step 1

Lesson name

Например:

Irodori Lesson 1

Step 2

Target language:

Japanese

Step 3

Translation languages:

Russian
German
English

Можно выбрать несколько.

Step 4

Active translation:

Russian

Step 5

Paste words — one per line

Textarea:

私
これ
本

Empty lines игнорировать.

Каждую непустую строку воспринимать как отдельное target word.

Показать preview и количество слов.

Step 6

Generate Cards

Попытаться:

создать Cards;

автоматически заполнить translations;

подобрать image suggestion;

подготовить system TTS.

Step 7

Review Cards

Показывать удобную сетку.

Каждая Card отображает:

image;

target;

translations;

audio preview;

Edit.

Карточку можно открыть и исправить:

target;

pronunciationText;

translations;

image;

audio.

Показывать состояния:

Ready
Missing image
Missing translation
Audio unavailable

Lesson готов к тренировке только когда используемые карточки complete.

16. DUPLICATE WORDS

Внутри одного Lesson не допускай две полностью идентичные target strings как разные независимые карточки, потому что это создаст неоднозначность в Chaos и multiple choice.

Если при создании Lesson target уже существует:

предложить использовать существующую Card или явно показать duplicate warning.

При создании нового Lesson из существующих Cards никаких дублей Card создавать не нужно.

17. LEARN MODE — ОСНОВНОЙ АЛГОРИТМ

Это центральная механика приложения.

Не заменяй её алгоритмом повторения. Три этапа Learn остаются обязательным первичным изучением; FSRS начинается только после статуса Learned.

Каждое слово изучается ровно через три основных этапа:

STAGE 1

Meaning Block → Word choice

Показывается:

[IMAGE]

TRANSLATION

Ниже несколько foreign words.

Игрок выбирает правильный target.

STAGE 2

Word → Meaning Block choice

Показывается:

FOREIGN WORD

Ниже несколько Meaning Blocks.

Каждый Meaning Block:

IMAGE + TRANSLATION

Игрок выбирает правильный.

STAGE 3

Meaning Block → Manual typing

Показывается:

[IMAGE]

TRANSLATION

Text input.

Игрок должен самостоятельно написать FOREIGN WORD.

18. BATCHES

Learn работает пачками максимум по 10 слов.

Пример Lesson:

20 words.

Начальная Batch 1:

10 new words.

Сначала все 10 проходят Stage 1.

Затем те же 10 проходят Stage 2.

Затем те же 10 проходят Stage 3.

Только после завершения всех трёх стадий формируется следующая Batch.

19. КОГДА WORD СЧИТАЕТСЯ LEARNED

Card внутри конкретного Lesson считается Learned только если во время текущего batch cycle пользователь прошёл:

Stage 1

Stage 2

Stage 3

БЕЗ ЕДИНОЙ ОШИБКИ по этому target word.

Если хотя бы в одном из трёх основных этапов была ошибка:

Card НЕ считается Learned в этой Batch.

Даже если пользователь потом исправил ошибку.

Delayed retry не удаляет факт ошибки.

20. ERROR HANDLING В LEARN

При первой ошибке:

показать Incorrect;

вопрос остаётся;

пользователь пытается ещё раз;

правильный ответ НЕ показывать;

audio НЕ проигрывать, чтобы не раскрывать ответ.

При второй ошибке:

вопрос всё ещё остаётся;

появляется дополнительная кнопка:

"Give up / Show answer"

Пользователь может продолжать пытаться сколько хочет.

Если пользователь наконец отвечает правильно:

показать Correct;

проиграть audio;

перейти дальше.

Но Card остаётся dirty/error для этого batch cycle.

Если пользователь нажимает Give up:

показать правильный ответ;

проиграть audio;

перейти дальше;

Card остаётся dirty/error.

21. DELAYED RETRY

Каждая ошибка должна создавать delayed retry.

Не повторять вопрос сразу после ошибки.

Запланировать повтор примерно через случайные 5–10 последующих вопросов текущей Learn session.

Повтор должен использовать тот же тип задания, в котором произошла ошибка.

Например:

ошибка была:

Meaning → Word choice

через несколько заданий снова показать Meaning → Word choice для этой Card.

Если session/batch boundary наступает раньше, delayed retry может естественно перейти через stage/batch boundary в рамках той же Learn session.

Не создавать искусственно длинные бессмысленные filler loops только ради точного числа 5–10.

Главный принцип:

retry не должен идти сразу после ошибки и должен появиться через несколько других вопросов.

Delayed retry существует для закрепления.

Он НЕ очищает dirty flag.

22. CARRY-OVER DIFFICULT WORDS

После прохождения трёх Stage текущей Batch:

разделить слова на:

clean learned
и
difficult/error words.

Пример:

Batch 1:

10 words

7 прошли три Stage без ошибок.
3 имели хотя бы одну ошибку.

Результат:

7 становятся Learned.

3 переходят в следующую Batch.

Если Lesson содержит ещё новые слова:

следующая Batch заполняется сначала difficult words, затем новыми словами до максимум 10.

Например:

Batch 2 = 10.

Если:



Если:



Не добавлять искусственно уже Learned слова только ради заполнения до десяти.

23. REMEDIAL BATCHES

Когда новых слов больше нет, но difficult words остаются:

создавать новую Batch только из них.

Они снова проходят все три Stage.

Card становится Learned только когда проходит целую Batch через:

Stage 1
Stage 2
Stage 3

без единой ошибки.

Learn session заканчивается, когда:

new words = 0

difficult words = 0

То есть все Cards Lesson Learned.

24. MULTIPLE CHOICE

По умолчанию показывать 4 варианта.

Distractors выбирать из текущих/уже участвовавших Cards Lesson.

Не показывать одинаковые visible options.

Если вариантов меньше четырёх — показывать столько корректных уникальных вариантов, сколько возможно.

Не блокировать тренировку только потому, что Lesson содержит меньше четырёх Cards.

Порядок вариантов рандомизировать.

Не ставить правильный ответ постоянно в одной позиции.

25. TYPING RULE

Manual typing проверяется строго.

Пользовательский ответ должен совпасть с target практически на 100%.

Разрешённое исключение:

регистр букв игнорируется.

Например:

Book
book
BOOK

эквивалентны.

Не разрешать:

опечатки;

missing characters;

extra characters;

неправильные пробелы;

альтернативный перевод;

альтернативное написание;

reading вместо target, если target другой.

Используй только техническую Unicode canonical normalization, чтобы одинаковые Unicode representations не считались разными.

Не делай fuzzy matching.

Не используй Levenshtein tolerance.

26. IME SUPPORT

Критически важно для Japanese / Chinese / Korean.

Во время active IME composition Enter НЕ должен submit answer.

Использовать compositionstart / compositionend или соответствующий React mechanism.

Пример:

пользователь набирает:

hon

IME превращает это в:

本

Enter, которым подтверждается IME candidate, не должен одновременно отправить форму.

Submit разрешён только после окончания composition.

27. AUDIO DURING LEARN

После правильного ответа:

коротко показать правильное состояние;

автоматически воспроизвести Card audio;

перейти к следующему вопросу.

После Give up:

показать правильный target;

воспроизвести audio;

перейти дальше.

После неправильной попытки до правильного ответа audio не проигрывать.

Не создавать отдельный Audio Quiz mode в Learn.

28. TIMER

Все упражнения измеряются по времени.

Но timer является только статистикой.

НЕ использовать:

countdown;

time limit;

failure by time;

automation threshold;

score multiplier;

"too slow";

"fast enough".

Для обычного вопроса:

start timer:
когда prompt полностью показан и пользователь может отвечать.

stop timer:
когда пользователь наконец дал правильный ответ или закончил через Give up.

Если пользователь сделал ошибки, всё потраченное время остаётся частью response time.

Хранить в миллисекундах.

На UI можно показывать секунды с разумной точностью.

29. STATISTICS

Для каждой Card глобально показывать:

Accuracy

Average response time

Questions

Errors

Например:

本

Accuracy: 84%
Average time: 2.38 s
Questions: 31
Errors: 5

Timer не определяет learned/unlearned.

Learned — отдельное состояние внутри конкретного Lesson.

30. ACCURACY PENALTY ПРИ ПУТАНИЦЕ

Это принципиально важное правило.

Пример:

Prompt:

[BOOK IMAGE]
книга

Правильный target:

本

Пользователь ошибочно нажимает:

人

Тогда:

本 получает +1 error.

人 тоже получает +1 error.

Потому что пользователь не только не вспомнил 本, но и ошибочно связал 人 со значением "книга".

Когда затем пользователь выбирает 本 правильно:

本 получает +1 correct.

То есть одна попытка может дать:

本:
+1 error
+1 correct

人:
+1 error

31. WRONG TYPING

В Stage 3:

если пользователь должен написать:

本

но пишет:

ほんん

ошибку получает только expected Card 本.

Но если пользователь вводит точный target другой существующей Card этого Lesson, например:

人

то ошибку получают:

expected Card 本
и
mistaken Card 人.

Определяй mistaken Card только при точном совпадении с target другой Card.

32. DIRTY STATUS И WRONG DISTRACTOR

Если во время Learn пользователь ошибся:

dirty/carry-over status получает expected Card — то слово, которое реально проверялось.

Mistaken distractor Card получает снижение Accuracy/error statistics, но не обязана автоматически становиться difficult carry-over только из-за того, что её выбрали как неправильный distractor.

33. AUTOMATE MODE

Automate предназначен для произвольной пользовательской практики уже существующих Cards и не имеет progression stages. Плановое SRS-повторение живёт отдельно на экране «Сегодня».

Два основных режима:

Quick Choice

Chaos

34. QUICK CHOICE

Quick Choice быстро чередует:

Type A

Meaning Block
→ выбрать foreign word

Type B

Foreign word
→ выбрать Meaning Block

Пользователь может выбрать:

Mixed

Meaning → Word only

Word → Meaning only

Настройки длины:

10 questions

20 questions

50 questions

Endless

Каждый вопрос:

измеряет response time;

обновляет Accuracy;

после правильного ответа проигрывает audio.

Ошибки используют те же statistical penalty rules.

Никаких carry-over batches в Automate.

35. CHAOS MODE

Chaos напоминает matching/memory game.

Экран содержит одновременно два типа блоков.

Например:

WORDS:

本
人
水
これ

MEANING BLOCKS:

[image] человек
[image] вода
[image] книга
[image] это

Порядок случайный.

Игрок должен соединить правильные пары.

36. CHAOS INTERACTION

Не использовать drag-and-drop как обязательный основной способ.

Основное управление — tap/click.

Игрок может начать с любой стороны.

Например:

tap 本
→ 本 становится selected
→ audio 本 автоматически проигрывается

потом tap [book + книга]
→ пара правильная.

Или:

tap [book + книга]
→ selected

потом tap 本
→ правильная пара.

Оба направления должны работать одинаково.

37. CHAOS SAME-SIDE SELECTION

Если selected:

本

и пользователь нажимает другое foreign word:

水

это НЕ ошибка.

Просто selection переключается на 水.

Проигрывается audio 水.

Аналогично:

если выбран Meaning Block и пользователь нажимает другой Meaning Block:

selection просто переносится.

Ошибка возникает только при попытке соединить:

WORD + MEANING BLOCK

которые друг другу не соответствуют.

38. CHAOS CORRECT MATCH

При правильном match:

короткая визуальная feedback;

пара становится completed;

затем исчезает или остаётся disabled/visually completed;

статистика expected Card получает correct;

записывается response time пары.

Response time пары:

от момента выбора первого элемента пары до выбора правильного второго.

Также показывать общий timer раунда.

39. CHAOS WRONG MATCH

Пример:

本
соединяется с
[PERSON IMAGE + человек]

Правильная Card Meaning Block = 人.

Ошибка записывается:

本 +1 error
人 +1 error

Пара не удаляется.

Игрок продолжает.

40. CHAOS ROUND SIZE

До 10 пар на desktop, если layout позволяет.

На маленьком mobile адаптировать количество/раскладку так, чтобы UI не становился неудобным.

Рекомендуемый mobile round:

4–6 pairs.

Большой Lesson разбивается на несколько random Chaos rounds.

Не делать горизонтально неудобный desktop-only interface.

41. CREATE LESSON FROM SELECTED CARDS

На Lesson detail page показать Cards и статистику.

Пользователь может выбрать checkbox рядом с Cards.

Кнопка:

"Create lesson from selected"

Создать новый Lesson, который ссылается на существующие Card IDs.

НЕ дублировать Cards.

Новый Lesson имеет собственный LessonProgress.

Global Accuracy / Average Time остаются общими.

Это основной способ пользователя самостоятельно выделять слабые слова.

42. LESSON DETAIL

Показывать:

Lesson name
Number of cards
Learned count
Average Accuracy
Average response time

Actions:

Learn
Automate
Edit

Ниже Cards.

Для каждой:

image thumbnail

target

active translation

Accuracy

Average time

Errors

Learned status for this Lesson

checkbox

Edit

Sorting:

Alphabetical

Lowest Accuracy

Highest Accuracy

Slowest

Fastest

Most Errors

43. HOME / LESSONS

Главный экран:

My Lessons

Пример:

Irodori — Lesson 1

20 cards
20 learned
Accuracy 88%
Avg. 2.4 s

[Learn]
[Automate]
[Edit]

Показать все Lessons современными responsive cards/list.

Кнопка:

New Lesson

44. RESUMABLE LEARN SESSION

Learn session должна сохраняться.

Если пользователь:

обновил страницу;

закрыл PWA;

случайно вышел;

не терять весь прогресс текущего обучения.

Сохранять:

current Batch;

remaining new Cards;

difficult Cards;

current Stage;

current question position;

dirty flags;

delayed retry queue;

temporary batch state.

При следующем открытии предложить:

Resume Learning Session

или

Restart Session

45. FULL BACKUP

IndexedDB является локальным хранилищем, поэтому обязательно реализовать:

Export Full Backup

Import Full Backup

Backup должен содержать:

Cards

Lessons

memberships

progress

global statistics

translations

images

custom audio

settings

schemaVersion

Сделай переносимый единый backup-файл.

Лучше использовать zip-container с JSON manifest + binary assets, а не огромный base64 JSON.

Можно использовать JSZip или аналогичную стабильную библиотеку.

46. LESSON EXPORT / IMPORT

Отдельно реализовать:

Export Lesson
Import Lesson

Lesson export предназначен для того, чтобы пользователь мог отправить готовый Lesson знакомому.

Он должен содержать:

Lesson metadata

Cards

translations

images

pronunciationText

custom audio if present

image attribution metadata

НЕ экспортировать личную статистику пользователя.

После import другой пользователь получает чистый Lesson с нулевой своей статистикой.

47. STORAGE

Использовать IndexedDB через Dexie.

При первом сохранении пользовательских данных попытаться запросить persistent storage:

navigator.storage.persist()

Если браузер не поддерживает — приложение продолжает работать.

В Settings показать storage/backup section.

Не пугать пользователя техническими деталями, но дать возможность backup.

48. OFFLINE / PWA

Приложение должно быть installable PWA.

Добавить:

manifest

icons

theme metadata

service worker

offline app shell

Core learning features должны работать без сети:

existing Lessons

Cards

images

translations

custom audio

system TTS if device supports

Learn

Automate

Chaos

stats

Online-only enhancements:

automatic translation if browser requires/downloads model

Wikimedia image search

Если сеть отсутствует:

не ломать основной app.

Показать нормальный fallback.

49. DEPLOYMENT

Production build должен быть static-hostable.

Никакого backend requirement.

Создай README с инструкциями:

install

dev

test

build

preview

static HTTPS deployment

Приложение должно быть пригодно для размещения на обычном HTTPS static host.

Не хардкодить localhost URLs.

50. ONBOARDING

Приложение должно выглядеть законченным при первом открытии.

Первый экран:

коротко объясняет:

"Build vocabulary through meaning, sound and speed."

Actions:

Create your first lesson
Import lesson

Не делай длинный onboarding tutorial.

51. LESSON IMPORT ENTRY POINT

Главный экран содержит `Import lesson`, открывающий канонический `.vtlesson` import workflow. Встроенный demo Lesson, автоматическая demo generation и demo-only assets отсутствуют. Settings не дублирует эту пользовательскую кнопку импорта.

52. UI / VISUAL QUALITY

Приложение должно выглядеть как законченный современный продукт, а не developer prototype.

Требования:

clean minimal interface

responsive desktop/mobile

light theme

dark theme

touch-friendly buttons

keyboard friendly

clear visual hierarchy

Meaning Block image занимает заметную часть карточки, когда изображения включены и image существует

никакого визуального мусора

никакой Duolingo imitation

никакой Quizlet imitation

никаких emoji как UI icons

использовать нормальные SVG/icon components

не злоупотреблять animations

без confetti

без gamification clutter

Можно использовать Lucide icons или аналогичную lightweight icon library.

53. LEARN UI

Показывать progress:

например:

Batch 2
Stage 1 / 3
Question 6 / 10

Также можно показать:

7 learned
3 difficult

Но не перегружать экран.

Во время вопроса главный focus должен быть на prompt и answers.

54. FEEDBACK

Правильный ответ:

clear positive visual feedback;

audio;

короткая задержка;

next.

Ошибка:

clear negative feedback;

текст Incorrect;

неправильный option temporarily disabled/marked;

не использовать только цвет как единственный feedback.

После второй ошибки показать Give up.

55. KEYBOARD CONTROLS

Desktop:

1–4:
multiple choice answers

Enter:
submit typing

Enter во время IME composition:
НЕ submit

Space:
replay audio там, где replay доступен и focus не находится в input/textarea

Escape:
pause / exit confirmation / close dialog, где логично

Не перехватывать клавиши во время text editing неправильно.

56. ACCESSIBILITY

Использовать semantic HTML.

Buttons должны быть buttons.

Inputs иметь labels.

Keyboard navigation должна работать.

Focus states видимы.

Не полагаться только на цвет.

Meaning images должны иметь sensible alt text, когда возможно.

Поддерживать prefers-reduced-motion.

57. PERFORMANCE

Не загружать все full-resolution images одновременно, если Lesson большой.

Использовать thumbnails/lazy loading где разумно.

Не делать unnecessary rerenders больших Lesson lists.

Все пользовательские действия должны ощущаться быстрыми.

58. ERROR STATES

Обработать:

empty Lesson

missing image как информативное состояние, не блокирующее practice

missing visible translation

no TTS voice

microphone denied

corrupted import

unsupported backup version

failed image search

automatic translation unavailable

offline network request

duplicate Card

broken image

failed audio recording

IndexedDB errors

Никогда не показывать пользователю:

undefined
NaN
Infinity
raw stack trace

59. DELETE BEHAVIOR

Удаление Lesson:

не должно автоматически удалять global Cards, которые используются другими Lessons.

Если Card больше не используется ни в одном Lesson, можно предложить:

Keep Card
Delete Card

Удаление Card, используемой несколькими Lessons, должно требовать понятного confirmation.

60. TESTING — ОБЯЗАТЕЛЬНО

Не ограничивайся ручной проверкой.

Unit tests

Покрыть как минимум:

Batch creation max 10

3 difficult + 7 new

difficult carry-over

no-new-words remedial batches

clean word becomes Learned only after all 3 stages with no errors

one error prevents Learned for current Batch

delayed retry scheduling

Give up behavior

typing exact-match rules

case-insensitive typing

Unicode normalization

IME submit protection logic where testable

Accuracy formula

average response time

wrong distractor penalizes both expected + mistaken Card

typing another exact Card target penalizes both

random typo penalizes expected only

Chaos correct matching

Chaos mismatch penalizes both Cards

same-side Chaos selection does NOT produce error

lesson reuse without Card duplication

translation line alignment

missing translation validation

backup serialization/deserialization

lesson export excludes user statistics

61. E2E TESTS

Playwright должен проверить минимум этот реальный сценарий:

Open app.

Create Lesson.

Paste at least 12 words.

Add/fill translations.

Add/assign images.

Verify Lesson becomes ready.

Start Learn.

Deliberately answer some questions incorrectly.

Verify retry occurs later.

Finish all three stages.

Verify clean words become Learned.

Verify difficult words move into next Batch.

Complete difficult words cleanly.

Verify whole Lesson becomes Learned.

Open stats.

Verify Accuracy/errors exist.

Start Quick Choice.

Complete several questions.

Open Chaos.

Match correct pair.

Make an intentional wrong match.

Verify both involved Cards receive error stats.

Export Lesson.

Import Lesson.

Verify imported Lesson works and has no personal statistics.

Export Full Backup.

Restore backup.

Verify data survives restore.

62. QUALITY GATE

Перед завершением работы обязательно выполнить:

install dependencies

typecheck

lint

unit tests

integration/component tests

Playwright E2E

production build

Исправить ошибки.

Не заканчивать задачу с формулировкой "the rest can be implemented later", если это часть данного MVP.

Не оставлять неработающие кнопки.

Не создавать fake controls.

Если функция недоступна в конкретном браузере, реализовать корректный fallback.

63. PROJECT STRUCTURE

Код должен быть модульным.

Не складывать всё приложение в:

App.tsx

или один огромный файл.

Разделить минимум концептуально:

data/database

models

learning engine

statistics engine

audio service

translation service

image search service

import/export

components

pages

hooks

i18n

tests

Learning algorithm вынести из UI в отдельный хорошо тестируемый module.

Chaos logic также не смешивать полностью с visual component.

64. SOURCE OF TRUTH

Эта спецификация является source of truth.

Особенно не менять самостоятельно следующие продуктовые решения:

Meaning Block = image + translation together

3 Learn stages only

batches of max 10

difficult words carried into next Batch

Learned only after all 3 clean

delayed retries

exact typing

FSRS starts only after Learned

timer is statistics only

Accuracy is user-facing metric

errors can penalize both confused Cards

global Card statistics

Cards reusable across Lessons

Automate = Quick Choice + Chaos

audio always present

multilingual translations

interface language independent from translation language

65. FINAL PRODUCT GOAL

Главный пользовательский сценарий должен выглядеть так:

Пользователь проходит Irodori.

Он видит 20 новых японских слов.

Открывает Vocabulary Trainer.

Создаёт:

"Irodori Lesson 3"

Выбирает:

Target language:
Japanese

Translation languages:
Russian
German
English

Active translation:
Russian

Вставляет:

私
これ
本
...

Приложение по возможности:

автоматически делает translations;

автоматически предлагает images;

автоматически предоставляет TTS.

Пользователь быстро проверяет Cards.

Исправляет несколько неудачных картинок или переводов.

Нажимает Learn.

Первые 10 слов проходят:

Meaning → Word

затем:

Word → Meaning

затем:

Meaning → Typing.

Ошибочные задания возвращаются позже.

7 clean words уходят в Learned.

3 difficult words переходят в следующую Batch вместе с 7 новыми.

Процесс продолжается, пока все слова не пройдут три стадии без ошибки.

После этого пользователь открывает Automate.

Quick Choice позволяет быстро тренировать ассоциации на скорость.

Chaos позволяет быстро соединять word ↔ Meaning Block, а при нажатии на word пользователь слышит pronunciation.

На Lesson page пользователь видит:

Accuracy
Average time
Errors

для каждого слова.

Если некоторые Cards слабые, пользователь отмечает их checkbox и создаёт отдельный Lesson из selected Cards.

Приложение никогда не говорит пользователю, когда он обязан повторять материал.

67. LANGUAGE-AGNOSTIC PRODUCT REVISION

Этот раздел является более новой продуктовой ревизией и имеет приоритет над любыми противоречащими формулировками разделов 1–66.

Vocabulary Trainer одинаково поддерживает произвольные target и translation languages. Generic domain code не содержит Japanese-specific assumptions. Japanese используется только как явно названный demo/example и как один из adapter-specific TTS providers.

Все известные языки описываются централизованным registry. Запись содержит stable BCP-47-compatible language code, локализуемое display name, preferred TTS locale и optional aliases. Минимальный registry: English, German, Spanish, French, Italian, Japanese, Korean, Chinese, Ukrainian и Russian. Архитектура допускает custom BCP-47 code для языка вне registry.

Application Settings хранит независимо от interface language:

defaultTargetLanguage optional;

translationLanguages — непустой список известных пользователю языков;

defaultActiveTranslationLanguage из этого списка;

defaultVisibleTranslationLanguages — непустое подмножество translationLanguages, включающее defaultActiveTranslationLanguage;

useImages;

per-language audio preferences: locale, selected system voice, speech rate и consent для application fallback.

Новый Lesson получает эти defaults, но пользователь может изменить target language, translation languages, active/visible translations и image mode для конкретного Lesson.

Settings screen объединяет General, Languages, Audio и Storage. Основная navigation не содержит отдельного Image Credits entry.

Application audio provider priority:

1. Card custom audio;

2. system SpeechSynthesis voice, язык которого подходит target locale;

3. явно включённый application fallback provider;

4. clean unavailable state.

Japanese application fallback использует лениво загружаемый browser-only Kokoro/OpenJTalk provider. Перед первой загрузкой пользователь видит приблизительный download/runtime storage size и подтверждает действие. Provider assets/model по возможности используют HTTP/Cache API/OPFS cache; ошибка загрузки не ломает приложение. Ничего из этого не загружается при обычном старте.

`pronunciationText` остаётся generic readable/pronunciation form. Generic model, UI и services не называют его kana/furigana/hiragana.

Windows distribution содержит `start.bat` и `build.bat`. `start.bat` проверяет Node/npm, при отсутствии `node_modules` выполняет `npm install`, запускает Vite и открывает predictable local URL без PowerShell execution policy. `build.bat` выполняет production build и сообщает путь `dist`.

Дополнительные обязательные regression tests:

Learn с image и без image;

Quick Choice без image;

readiness не требует image;

German target + Russian translation;

Spanish target + German translation;

Japanese target + English translation;

Settings language defaults применяются к новому Lesson и не зависят от interface language;

system TTS выбирается только по подходящему locale;

при отсутствии system voice используется включённый поддерживаемый fallback, а неподдерживаемый fallback даёт clean unavailable state;

custom audio сохраняет высший приоритет;

image attribution переживает export/import без prominent Credits navigation;

существующие settings/Lessons безопасно мигрируют.

68. MULTI-TRANSLATION И LATENCY REVISION

Этот раздел имеет приоритет над прежними формулировками про показ только одного перевода.

Lesson хранит `visibleTranslationLanguages`. Пользователь может включить одновременно несколько переводов из `translationLanguages`; `activeTranslationLanguage` является primary и не может быть скрыт. Learn, Quick Choice и Chaos используют один общий Meaning Block с тем же набором переводов. Readiness проверяет каждый выбранный visible translation и показывает язык отсутствующего значения.

Изменение visible translations не сбрасывает progress или global Card statistics. Lesson export/import и full backup сохраняют выбор; старые Lessons мигрируют к `[activeTranslationLanguage]`.

Learning engine transition и React обработка ответа не должны ждать TTS. Короткий feedback delay после завершённого вопроса имеет target 250–350 ms. Domain transition на обычном desktop test environment должен укладываться в 10 ms для batch до 10 Cards, а локальное переключение следующего вопроса — в 100 ms после feedback delay без учёта browser paint throttling.

Application fallback отделяет неизбежную first-use model/dictionary загрузку от обычного воспроизведения: показывает loading state, кэширует синтезированный результат по provider/voice/text и повторно использует его. Ошибка или медленная сеть не блокирует переход к следующему вопросу. Performance regression tests измеряют engine transition, UI transition и повторный cached synthesis path без скачивания большой модели в test suite.

69. PREGENERATED LOCAL TTS AUDIO

При создании набора Cards приложение заранее подготавливает произношение для каждой Card, если для target language включён application TTS provider, способный возвращать аудио Blob. Общие model/runtime assets провайдера загружаются один раз и переиспользуются; отдельная модель на каждый Lesson или Card не создаётся.

Готовое аудио сохраняется локально в IndexedDB как производный TTS cache с ключом, учитывающим Card, provider, voice, pronunciationText/target и настройки синтеза. Оно не должно записываться в `customAudio`, потому что пользовательская запись имеет отдельный смысл и высший приоритет.

Создание Lesson сохраняет Cards и memberships до запуска длительного синтеза. UI показывает понятный progress подготовки аудио. Ошибка сети, провайдера или одной Card не откатывает созданный Lesson: карточка остаётся доступной, а приложение может повторить синтез позже или использовать system/custom audio.

Playback priority становится:

custom Card audio;

подходящий system TTS voice;

совместимое заранее сохранённое generated TTS audio;

on-demand application provider с последующим локальным сохранением;

unavailable state.

Generated TTS audio является локальным производным cache: оно включается в full backup для сохранения офлайн-готовности, но не экспортируется в Lesson package как пользовательское custom audio. Restore валидирует связи cache records с существующими Cards. Удаление Card удаляет связанные generated audio records; удаление одного Lesson не удаляет cache общей Card, если Card сохраняется.

Для системного `SpeechSynthesis` предварительная запись не выполняется, потому что стандартный browser API не предоставляет переносимый аудио Blob. Такой голос продолжает воспроизводиться непосредственно устройством.

70. LOCAL LESSON LIBRARY И USER-CONTROLLED PRACTICE REVISION

Этот раздел является более новой продуктовой ревизией и имеет приоритет над противоречащими формулировками разделов 1–69.

Пользователь управляет переходом после завершённого вопроса. После правильного ответа или Give up приложение оставляет текущий вопрос, Meaning Block, правильный ответ и feedback на экране. Следующий вопрос открывается только по явной кнопке `Next` или клавише Enter, когда focus не находится в редактируемом поле. Автоматический delay-переход удаляется из Learn и Quick Choice. Озвучка не блокирует кнопку перехода.

Планировщики Learn и Quick Choice не должны показывать одну и ту же Card два завершённых вопроса подряд, если в текущем доступном наборе существует другая Card. Это правило действует на границах stages/decks и для delayed retries. Повтор после ошибки остаётся delayed, но несколько ошибок в рамках одного незавершённого вопроса не создают очередь одинаковых retries: для Card/exercise/source question поддерживается не более одного pending retry.

Если у Card есть image и изображения включены для Lesson, image должен eager-render во всех видимых practice Meaning Blocks. Ошибка декодирования показывается как понятное состояние, но lazy loading не должен оставлять видимое задание без существующей картинки.

`activeTranslationLanguage` сохраняется как внутреннее совместимое поле формата, но больше не является отдельным пользовательским выбором или обязательной «основной» галочкой. Пользователь выбирает только непустой список видимых переводов; первый выбранный язык автоматически используется как внутренний primary. Все выбранные переводы равноправно показываются в Meaning Block.

Global Settings и Lesson Settings используют один набор общих controls и одну persistence-модель. Открытие Settings из Lesson передаёт Lesson context; изменение языков показа, image mode или TTS одновременно обновляет текущий Lesson и соответствующие defaults для новых Lessons. Отдельный экран с расходящимися настройками не допускается.

Application TTS runtime и Japanese G2P assets не входят в базовую desktop distribution. Пользователь заранее видит размер и явно скачивает optional package; UI показывает progress, Installed и Delete package. Desktop хранит пакет в portable data directory и использует его после перезапуска без повторной загрузки. Удаление языка из списка настроенных voices не удаляет пакет. Во время practice скрытая сетевая загрузка не начинается. Общий engine/model загружается один раз на этапе подготовки Lesson; созданные per-Card audio records сохраняются и затем используются без повторного синтеза.

Lesson package становится каноническим самодостаточным файлом содержимого Lesson. Он включает metadata, Cards, translations, images, pronunciationText, custom audio, image attribution и generated application-TTS audio. Личная statistics, Learn session и progress в него не входят.

Приложение предлагает выбрать корневую локальную папку библиотеки. В поддерживающем File System Access API браузере оно создаёт внутри папку `lessons` и автоматически записывает/обновляет `<lesson-id>.vtlesson` после создания или изменения Lesson. Разрешение выдаётся пользователем через directory picker; браузер не должен обходить sandbox. Если API отсутствует или permission потерян, IndexedDB остаётся рабочим источником и доступно обычное скачивание Lesson package. Full backup сохраняется как отдельная аварийная копия всей пользовательской statistics/settings/history и не заменяет файлы Lessons.

Filesystem boundary должен быть adapter-based, чтобы будущие APK/desktop оболочки могли заменить browser picker прямым доступом к app storage без изменения domain engines или portable Lesson format.

71. RELEARN AND WINDOWS DESKTOP OVERRIDES

Этот раздел добавлен по прямому запросу пользователя и имеет приоритет над прежними формулировками о будущей desktop-упаковке.

`Restart Session` после полностью выученного Lesson начинает новый Learn со всеми Cards этого Lesson. Операция атомарно удаляет прежние Learn sessions и сбрасывает lesson-specific `Learned`/temporary learning state, но не удаляет глобальную Card statistics.

Проект предоставляет Windows x64 desktop build. Desktop оболочка использует те же React UI, domain engines, IndexedDB schema и portable formats, не дублируя learning rules.

72. FINAL SETTINGS QA OVERRIDES

Этот раздел имеет приоритет над прежними конфликтующими формулировками.

Audio работает автоматически без обязательной настройки: Lesson определяет target language, language registry — preferred locale, а provider boundary выбирает matching system voice и затем установленный поддерживаемый fallback. `Settings → Audio → Language voices` показывает только добавленные пользователем языковые строки с локализованным названием и единым dropdown `Auto`/system voices/installed application voices. Отдельное пользовательское поле Locale отсутствует; полезные региональные варианты показываются как варианты голоса.

В `Settings → Languages` каждый выбранный translation language занимает отдельную полноширинную responsive строку с удалением.

Для новой установки theme по умолчанию — `dark`; существующий сохранённый выбор `system`, `light` или `dark` не мигрируется. При первой установке interface language определяется по system locale среди `en`, `ru`, `de`, `es`, иначе используется English; сохранённый выбор всегда имеет приоритет.

Application Settings содержит глобальный boolean `showJapaneseReadings`, default `false`. При включении Japanese Cards с kanji и существующим `pronunciationText` показывают это чтение semantic `<ruby>/<rt>` markup. Настройка не генерирует readings, не меняет Card, не участвует в typing validation и не применяется к другим target languages.

Desktop build не включает optional Japanese model/runtime package. После явной установки обычная работа и synthesis используют только копию в portable data directory и не обращаются к CDN/model host.

Desktop data root находится рядом с запускаемой сборкой в `Vocabulary Trainer Data`. Нативный storage adapter автоматически пишет Lesson packages в `Vocabulary Trainer Data/lessons` без browser directory picker. IPC boundary предоставляет renderer только ограниченные операции чтения root path, записи и удаления валидированного `.vtlesson` filename.

Renderer не получает Node integration. Desktop content обслуживается через зарегистрированный standard/secure custom protocol с включёнными context isolation и sandbox.

73. IMPORTED LESSON AUDIO PREPARATION OVERRIDE

Этот раздел добавлен по прямому запросу пользователя и имеет приоритет над прежним поведением импорта и on-demand application TTS.

Импорт Lesson является завершённым только после восстановления вложенного generated audio, предварительного создания всей отсутствующей application-TTS озвучки и записи обновлённого самодостаточного `.vtlesson` в локальную библиотеку. UI показывает progress подготовки. Только после этого открывается Lesson review.

74. OFFLINE TRANSLATION, IMAGE SEARCH, AUDIO И JAPANESE READINGS OVERRIDE

Этот раздел добавлен по прямому запросу пользователя и имеет приоритет над конфликтующими формулировками выше.

В `Settings → Languages` заголовок списка translation languages — `Offline translation packages`. В каждой строке языка кнопка установки/удаления офлайн-перевода находится непосредственно перед кнопкой удаления языка. Отдельного раздела со списком пар переводов нет. Один установленный многоязычный пакет обеспечивает перевод в обоих направлениях между всеми официальными языками registry. Список одновременно показываемых переводов не называется default.

Global `useImages` находится в `Special features`, а не в `Languages`.

Управление downloadable application voices находится в строке соответствующего добавленного audio language. Специального постоянно видимого Japanese package block нет. После установки application voice появляется в том же voice dropdown рядом с `Auto` и подходящими system voices.

Wikimedia image search и его UI удалены. Desktop открывает обычную страницу Google Images внутри sandboxed child window без Node integration и без scraping HTML. Пользователь явно выбирает изображение штатным context-menu action; приложение загружает только выбранный image URL, прогоняет его через общий optimizer и сохраняет доступный source URL без выдуманных author/license. Browser build использует безопасный external-browser fallback.

При включённом `showJapaneseReadings` Japanese Cards с kanji показывают semantic ruby reading во всех общих представлениях `TargetText`. Сохранённый `pronunciationText` имеет приоритет; при его отсутствии reading генерируется локально из bundled dictionary. Функция не меняет typing answer.

Full backup включает custom audio и сохранённые generated application-TTS records. Он не включает system voices и скачанные model/runtime packages из portable filesystem; эти пакеты устанавливаются отдельно после restore.

При открытии существующего Lesson приложение также проверяет локальную озвучку до запуска Learn/Quick Choice/Chaos. Пока подготовка выполняется, practice actions недоступны. Это обеспечивает обновление ранее импортированных Lessons и не допускает штатного синтеза по 3–5 секунд посреди задания.

Сначала сохраняются generated audio records, затем создаётся `.vtlesson`; обратный порядок недопустим. Успешно подготовленные записи входят в файл Lesson. On-demand synthesis остаётся только аварийным fallback после явной ошибки подготовки одной Card.

React/Vite frontend не является отдельной устаревшей браузерной реализацией: Electron исполняет этот production build, а будущая Android-оболочка также будет использовать его. Общие UI, domain engines и data layer нельзя переносить в legacy или удалять только из-за прекращения отдельной browser/PWA-дистрибуции.

66. ПОСЛЕ РЕАЛИЗАЦИИ

После того как приложение действительно реализовано и проверено:

дай мне только краткий итог:

что реализовано;

какие команды использовать для запуска;

где находится production build;

как развернуть static PWA;

какие browser-dependent функции могут иметь fallback.

Не трать финальный ответ на повторение всей спецификации.

Главный результат — рабочий проект в workspace, а не текстовое описание.

74. PORTABLE ELECTRON SHELL AND STORAGE OVERRIDE

Этот раздел имеет приоритет над прежними конфликтующими формулировками о desktop storage и выборе пользовательской папки.

Упакованная Windows-версия автоматически использует `Vocabulary Trainer Data` рядом с executable/distribution как Electron `userData`. Поэтому IndexedDB, Cache Storage и другие Chromium origin-файлы, а также `lessons` и установленные `tts-packages`, переносятся вместе со всей папкой приложения. Пользователь не выбирает Lessons directory вручную, и folder picker отсутствует в обычном Settings UI.

Если portable root пуст, а прежний Electron profile содержит IndexedDB/Local Storage/WebStorage, приложение до запуска renderer копирует старый profile в portable root. Legacy source не удаляется. Если каталог рядом с приложением недоступен для записи или копирование не удалось, приложение продолжает работу с прежним OS userData и показывает путь и понятное предупреждение.

Desktop Settings показывает фактический data path, рекурсивный размер application data и доступное место файловой системы. Chromium origin quota не показывается как maximum storage приложения.

Production shell удаляет стандартное Electron menu штатным API. Стандартные minimize/maximize/close controls сохраняются через native title-bar overlay; цвет overlay и `nativeTheme` синхронизируются с фактически выбранной светлой или тёмной темой.

Справа от theme toggle доступна локализованная красная кнопка Exit. Она работает через ограниченный preload/contextBridge IPC: renderer закрывает локальную Dexie database, main process ждёт завершения отслеживаемых native writes и только после этого вызывает штатное завершение приложения.

75. IMAGE SEARCH AND CLIPBOARD WORKFLOW OVERRIDE

Этот раздел имеет приоритет над прежними конфликтующими названиями и поведением Wikimedia-only search.

Card editor показывает generic editable Image Search query, которая не обязана следовать переводу Card после начальной подстановки. Основное действие открывает URL Google Images во внешнем browser через безопасную Electron external-link boundary. Приложение не scrapes Google HTML и не представляет Google Images как встроенный API. Wikimedia Commons остаётся дополнительным встроенным provider; для выбранного результата сохраняются доступные source/author/license metadata.

Рядом с Upload image доступна кнопка Paste from clipboard. Desktop использует ограниченный image-only preload IPC, browser — Async Clipboard API; permission denial, недоступность API и отсутствие image имеют понятные состояния. Ctrl+V в Card editor принимает image clipboard item, но paste events из input/textarea/select/contenteditable не перехватываются.

Clipboard PNG/JPEG, upload, drag/drop и provider download проходят через общий optimizer: maximum dimension 1024 px, PNG остаётся PNG для сохранения transparency, остальные совместимые форматы становятся WebP. Новое изображение заменяет draft preview. Clipboard image не получает выдуманные source/license/author metadata.

76. LESSON CREATION AND OFFLINE TRANSLATION OVERRIDE

Этот раздел имеет приоритет над прежними конфликтующими формулировками о семишаговом wizard и Browser Translator API.

Create Lesson состоит из шести шагов: имя, target language, translation languages, target words, translations, review. Target language выбирается searchable combobox по локализованному имени, английскому имени, коду или известному alias; внутри сохраняется стабильный language code. Translation languages показываются сразу как selectable rows без отдельного search/add и без повторного шага visible translations. Default active translation берётся из Settings, если он выбран, иначе используется первый выбранный язык; все выбранные языки становятся visible.

Automatic translation desktop-приложения работает через `TranslationProvider` и явно устанавливаемые local/offline packages. Поддерживаемая capability определяется направлением `target language → translation language`; неподдерживаемое направление не обещается. Установленные модели хранятся в portable `Vocabulary Trainer Data/translation-models`, проверяются до регистрации, сохраняются после restart и не удаляются при снятии checkbox языка. Settings показывает installed packages и позволяет удалить или скачать их повторно.

Перед установкой UI показывает направление и размер, во время загрузки — progress, затем выполняет verification. После установки перевод можно начать без restart. Загруженный inference pipeline переиспользуется, поддерживаемые списки обрабатываются batch-вызовами, а model loading отображается отдельно от translation progress. Основной production mechanism не использует Browser Translator API и после установки package не требует сети.

Translation editor показывает original target рядом с редактируемым переводом. Для нескольких языков используются tabs. Каждая строка имеет Auto translate, также доступен Auto translate all. Bulk paste сопоставляет одну непустую строку с одним target по индексу и применяет данные только при точном совпадении количества. Bulk automatic translation заполняет пустые значения и не заменяет полностью заполненный вручную список без подтверждения.

77. FINAL LOCALIZATION AND DISTRIBUTION OVERRIDE

Этот раздел имеет приоритет над прежним ограничением interface languages в разделе 72.

Canonical language registry является единым источником supported translation languages и обязательных UI locales. Для текущих кодов `de`, `en`, `es`, `fr`, `it`, `ja`, `ko`, `ru`, `uk`, `zh` интерфейс имеет полный каталог одинаковой структуры без English fallback placeholders. Локализованные названия языков берутся из того же registry. Interface language остаётся отдельной настройкой и не меняет target/translation languages Lesson.

Fresh settings определяют базовый код OS/system locale. Если он присутствует в canonical registry, он становится interface language; иначе используется English. Любая существующая сохранённая настройка имеет приоритет и не заменяется системным языком.

Публичный Windows ZIP содержит только runtime unpacked-приложения и полный набор требуемых Electron locale files. `Vocabulary Trainer Data`, Japanese TTS package, translation models и иные пользовательские/optional downloads в архив не включаются. После распаковки и запуска приложение само создаёт соседний portable data directory; перенос всей папки приложения вместе с этим каталогом сохраняет данные.

78. CUMULATIVE STATISTICS AND PRACTICE UX OVERRIDE

Global Card Statistics являются накопительными и общими для Learn, Quick Choice и Chaos. Переход между режимами, restart Learn session, изменение Lesson и повторное использование Card не заменяют прежние counters новыми session counters. Статистика сохраняется бессрочно, пока пользователь явно не сбросит её.

Lesson detail предоставляет явный сброс статистики отдельной Card и всех Cards текущего Lesson. Сброс Lesson удаляет глобальную статистику его Cards, поэтому shared Cards также сбрасываются в других Lessons; это явно указывается в confirmation. `LessonProgress.learned` и текущие learning sessions при статистическом сбросе не изменяются.

Видимый question timer останавливается в момент правильного ответа или Give up и не включает время просмотра feedback. Enter, отправивший typing answer, не может тем же keyboard event открыть следующий вопрос; следующий Enter работает только отдельным нажатием и только вне editable element.

Multiple-choice варианты Learn и Quick Choice показывают видимые клавиши `1`–`4` и принимают эти shortcuts, если focus не находится в input/textarea/select/contenteditable и не удерживаются modifier keys.

Активный question panel Learn и Quick Choice автоматически уменьшается относительно оставшейся высоты viewport, включая появившийся feedback, чтобы вопрос и controls оставались в видимой области без обязательной прокрутки.

79. USER-CONTROLLED PRACTICE BUILDER OVERRIDE

Practice Builder является отдельным режимом повторения и не заменяет Learn, его batches, stages или LessonProgress. Пользователь может выбрать одну или несколько Lessons с одинаковым target language. Shared Cards дедуплицируются по глобальному Card id и участвуют в сессии один раз.

Быстрые подборки являются независимыми multi-select переключателями: все Cards, ещё не тренировавшиеся, Learned, вручную отмеченные как трудные, ниже выбранной accuracy и с ошибкой за последние 30 дней. Их результаты объединяются в один итоговый список, который сразу отображается галочками в Manual Card selection; ручное добавление и исключение меняет тот же итоговый список. Отдельного конфликтующего режима «только выбранные вручную» и фильтра «когда-либо имевшие ошибку» нет. Global Card Statistics сохраняет optional `lastErrorAt`, обновляемый любой ошибкой из Learn, Quick Choice, Chaos или Practice Builder; recent-errors включает только timestamps моложе 30 суток. Порядок может быть random, alphabetical, most errors first или slowest first.

Конструктор поддерживает пять форматов: `translation + image when present → choose target`, `target → choose translation + image when present`, `audio → choose translation + image when present`, `audio → type target`, `translation + image when present → type target`. Можно включить несколько форматов и задать количество слов числом или ползунком. Каждое выбранное слово проходит каждый включённый формат один раз, а ошибки требуют дополнительных попыток; UI показывает минимальное производное число заданий. Изображение не отключается и всегда является частью meaning block, если оно есть у Card. Post-answer audio можно отключить. Audio-prompt formats всегда пытаются воспроизвести Card audio и показывают понятную ошибку, если источник недоступен.

Готовые presets: new words, fix mistakes, speed, dictation, learned review, test preparation и custom. Они только меняют видимые настройки конструктора и не изменяют FSRS-расписание экрана «Сегодня».

Multiple-choice mistakes штрафуют expected и mistakenly selected Cards; typing another exact Card target штрафует обе Cards; случайная опечатка штрафует только expected Card. Correct completion и response time записываются в общую накопительную статистику. Practice Builder не меняет Learned status.

Manual Card selection работает сразу по нескольким выбранным Lessons и является единственным источником истины для состава тренировки. Выбранные глобальные Cards можно сохранить как обычный постоянный Lesson без дублирования Card entities; новый Lesson получает совместимые translations и TTS-настройки исходного Lesson.

Card может иметь постоянную пользовательскую отметку «трудное слово», независимую от historical error count и Learned status. Отметка переключается в Lesson detail, Learn и Practice Builder, хранится по глобальному Card id и входит в full backup. На Home для каждого target language отображаются две автоматические живые Lessons-подборки: отмеченные трудные Cards и Cards с ошибкой за последние 30 дней. Они вычисляются из исходных Lessons, дедуплицируют shared Cards, не создают новых Card или Lesson entities и открывают Practice Builder с соответствующей быстрой подборкой.

80. PROGRESSIVE DISCLOSURE AND PRIMARY-ACTION UX OVERRIDE

Этот раздел является более новой продуктовой ревизией и имеет приоритет над прежними требованиями, которые заставляют одновременно показывать все навигационные и второстепенные действия.

Интерфейс сохраняет все существующие функции, но визуально подчёркивает наиболее частый путь: открыть приложение → выбрать Lesson → начать Learn. В основной навигации постоянно видны Lessons, Practice Builder и создание Lesson. Interface language, theme, Settings и desktop Exit объединяются в компактное utility menu.

Home не повторяет рекламный hero после появления Lessons. Последняя изменённая Lesson показывается как Continue learning с одним основным Learn action; остальные режимы доступны через secondary actions. Автоматические live collections не занимают место, пока пусты, а непустые коллекции находятся в раскрываемом разделе.

Lesson detail показывает Learn и Automate как основные действия. Edit, export, reset и delete находятся в menu дополнительных действий. Массовый выбор Cards включается отдельным selection mode; слово Card само открывает editor, а на строке постоянно остаются только быстрые действия для difficult marker и audio. Нормальное ready-state не повторяется на каждой строке — показываются только проблемы готовности.

Practice Builder сначала предлагает компактные готовые presets и однострочную сводку будущей сессии. Расширенные фильтры, форматы, порядок и ручное объединение Cards раскрываются через Customize session. Advanced presets остаются доступны через More actions. Это не меняет состав Cards или алгоритм тренировки.

Settings группирует General, Languages, Audio, Special features и Storage в раскрываемые sections; General открывается первым. В Card editor основной форме не конкурируют редкие custom-audio controls и image search: они раскрываются по запросу. Progressive disclosure обязано сохранять keyboard accessibility, локализованные accessible names и доступ ко всем функциям.

81. LESSON CONTENT TYPE AND SYMBOL HANDWRITING OVERRIDE

В Learn письменный этап Symbols Lesson по умолчанию показывает отключаемый пунктирный контур целевого знака, чтобы пользователь мог учиться обводить форму. Контур является только визуальной подсказкой и не входит в пользовательский рисунок. Действие под холстом называется «Проверить ответ», поскольку эталон уже виден; в самостоятельных режимах действие открытия скрытого эталона сохраняет название «Показать ответ». В Today Review, Practice Builder и отдельном Handwriting practice контур не показывается: эти режимы проверяют самостоятельное воспроизведение.

Если несколько Cards одного Symbols Lesson имеют одинаковое нормализованное чтение или значение, обратное задание не должно требовать угадать одну из равноправных карточек. Choice-вариант автоматически меняет направление на `target → meaning`, а handwriting-вариант принимает рисунок любого целевого знака с этим чтением. Это, в частности, относится к `じ/ぢ → ji` и `ず/づ → zu`.

Этот раздел имеет приоритет над прежними требованиями ручного ввода и glyph-choice-only поведения для японских kana study Cards.

При создании Lesson пользователь явно выбирает Words или Symbols. Phrases отображается как недоступный будущий тип. Symbols использует короткий поток «тип и название → язык → символы → подтверждение» без выбора языков перевода и заполнения переводов; описание этого режима относится к рукописи символов в целом и не выделяет японский язык. Для совместимости существующей модели Lesson приложение само выбирает служебный язык подсказки: локальное чтение для поддерживаемой kana или сам символ для других письменностей. Тип хранится на Lesson, поскольку одна глобальная Card может использоваться в разных учебных контекстах. Старый Lesson без типа считается Symbols, только если все его Cards являются одиночными kana или поддерживаемыми составными слогами; иначе он остаётся Vocabulary.

В Symbols Lesson письменный этап Learn, Today Review и typing-форматы Practice Builder используют responsive handwriting canvas с поддержкой мыши, пера и touch. Один ответ может состоять из любого числа раздельных штрихов; отпускание указателя завершает только текущий штрих и никогда не завершает задание. После открытия ответа исходный рисунок остаётся видимым рядом с эталоном.

Локальное визуальное сравнение нормализует размер рисунка и font-rendered эталона, вычисляет tolerant shape similarity и показывает процент вместе с предварительным решением. Сравнение оценивает узнаваемую общую форму и крупную структуру символа, а не точное совпадение рукописи с печатным шрифтом; индивидуальный почерк, небольшие смещения, отличающиеся изгибы и пропорции допустимы. Это не OCR и не проверка порядка штрихов. До записи результата пользователь подтверждает решение либо явно исправляет его в обе стороны: «система ошиблась — написано правильно» или «система ошиблась — написано неправильно». Также можно очистить попытку и нарисовать заново. В Vocabulary Lesson одиночная kana сохраняет glyph-choice поведение и не требует IME.

Сравнение не может основываться только на среднем расстоянии между пикселями. Итоговая оценка учитывает двустороннее покрытие контура, пространственную структуру, пропорции и плотность штрихов; неполный знак не засчитывается только потому, что оставшийся штрих совпал с частью эталона. Автоматическое решение остаётся предварительным и всегда подтверждается пользователем.

Lesson detail для Symbols Lesson содержит отдельный режим Handwriting practice. Он перемешивает все символы Lesson, показывает значение без целевого знака, принимает многоштриховой рисунок и после сравнения требует явного решения пользователя. Завершённая попытка обновляет общую статистику Card, но не изменяет Learn progress или SRS schedule. После последнего символа показываются точность и возможность начать новую тренировку.

Для Japanese vocabulary Card, target или сохранённое `pronunciationText` которой записано каной, typing exercise принимает два точных ответа: исходный Japanese target и его Hepburn romaji reading. Это устраняет зависимость от IME и неоднозначность `じ/ぢ → ji`, `ず/づ → zu`; после ответа приложение всё равно показывает правильное Japanese написание. Romaji не вычисляется из перевода и не принимается для non-Japanese Cards. Если чтение kanji Card неизвестно и `pronunciationText` отсутствует, дополнительный romaji answer не выдумывается.

82. LEARNER ANSWER CONTROL OVERRIDE

После «Не знаю ответ» до перехода к следующему вопросу также доступно «Я ответил правильно». Такое исправление переклассифицирует уже завершённую попытку: снимает ровно один записанный unknown-error, добавляет correct и не увеличивает повторно число завершённых вопросов или время ответа. Для Learn восстанавливается состояние вопроса до сдачи и применяется обычный correct transition.

В каждом активном exercise mode доступна кнопка «Не знаю ответ». Она сразу завершает текущую попытку как незнание, показывает правильный ответ или пару, записывает одну ошибку и не позволяет Learn Card случайно стать Learned в чистой batch. В Learn такая Card остаётся difficult и возвращается через delayed retry/remedial flow. Кнопка доступна до первой ошибки и не требует двух неудачных попыток.

83. AUTOMATIC LEARN HANDWRITING DECISION OVERRIDE

В письменном этапе Learn для Symbols Lesson действие «Проверить ответ» сразу принимает локальное визуальное сравнение как текущий результат: верно или неверно. Отдельное обязательное подтверждение этого решения не требуется. На экране сравнения пользователь может при необходимости переключить результат в любую сторону, после чего «Следующее задание» одним действием записывает выбранный результат и открывает следующий вопрос. Без ручного исправления обычный путь после рисования состоит из двух действий: «Проверить ответ» и «Следующее задание».

До перехода результат остаётся предварительным и не записывается в статистику или Learn progress. Поэтому ручное исправление не создаёт вторую завершённую попытку, не удваивает время ответа и не требует компенсирующих изменений статистики. Это правило имеет приоритет над прежним требованием обязательного подтверждения автоматического решения для письменного этапа Learn; самостоятельные assessment-режимы сохраняют собственное поведение.

84. EDUCATIONAL IMAGE SEARCH OVERRIDE

Этот раздел добавлен по прямому запросу пользователя и имеет приоритет над прежним предпочтением real-life photos.

Начальный Google Images query для Card сочетает значение и target с короткими уточнениями для детского иллюстрированного словаря и vocabulary flashcards. Поиск использует illustration/clip-art filter и не добавляет `"real life"`, `photo` или длинную цепочку отрицательных ключевых слов. Если пользователь явно вписал фотографический стиль, приложение уважает его запрос и не добавляет образовательные уточнения. Поле query остаётся редактируемым.

Если приложение отклонило введённый или выбранный ответ, рядом с feedback появляется кнопка «Я ответил правильно». Она относится только к последнему отклонённому ответу: отменяет его статистический error penalty, возвращает engine к состоянию до этого ответа и завершает вопрос как correct. Более ранние реальные ошибки по этой Card не отменяются. Кнопка не отображается до ошибки и исчезает после следующей попытки, перехода или ручного исправления.

Это поведение обязательно для Learn, Quick Choice, Practice Builder, Chaos и Today Review. В Today Review, где SRS rating ещё не записан, ручное исправление меняет feedback до выбора самооценки; самооценка и переход к следующей задаче остаются отдельными действиями.

85. UNIQUE VISIBLE CHOICE ANSWERS OVERRIDE

В заданиях с вариантами ответа две визуально одинаковые подписи не могут отображаться одновременно. Перед выбором вариантов приложение канонически нормализует Unicode, регистр и пробелы видимого текста; из эквивалентных вариантов сохраняется только один, причём правильный ответ не может быть удалён. Это распространяется на одинаковые чтения символов, включая `オ/ヲ → o`, а также на сохранённые Learn sessions: при возобновлении старый текущий вопрос с дублями автоматически пересобирается.

Если несколько символов имеют одно чтение, Learn использует однозначное направление вопроса и не требует различать равноправные ответы. Сокращение числа вариантов допустимо, когда недостаточно уникальных подписей; дублировать ответ ради заполнения четырёх кнопок запрещено.

86. LANGUAGE-LEARNING IMAGE QUERY OVERRIDE

Начальный поиск изображения строится из точного значения Card, точного target и английского названия изучаемого языка. Значение и target заключаются в отдельные кавычки, после чего запрос получает короткий контекст `beginner vocabulary flashcard educational illustration`. Это должно направлять выдачу к учебным карточкам, иллюстрациям и схемам для начинающих, включая абстрактные слова и грамматические элементы, а не к случайным совпадениям одного короткого слова.

Google Images не получает принудительный `clipart`-фильтр: он исключал полезные страницы учебников, грамматические схемы и готовые flashcards. Если пользователь явно указывает фотографический стиль, образовательный контекст не добавляется. Поле запроса остаётся редактируемым.

87. LESSON MANAGEMENT AND EDITING OVERRIDE

Home описывает Lessons как созданные пользователем материалы для изучения языков. Карточка Lesson имеет две явные учебные кнопки: компактную Learn и рядом Custom practice. Меню с многоточием содержит только действия над Lesson: Edit, Export и Delete; режимы тренировки не скрываются в этом меню.

Edit Lesson повторяет полный путь создания в одном последовательном списке: content type, название и target language, translation languages и переводы всех существующих Cards, добавление новых targets с построчными переводами, отображение и audio. Сохранение может одновременно обновить существующие переводы и добавить новые Cards в Lesson. Image toggle означает только показ уже добавленных Card images и прямо сообщает, что автоматического поиска или назначения изображений не выполняет.
