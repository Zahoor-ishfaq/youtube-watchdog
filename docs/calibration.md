# Calibration

How the thresholds in `src/lib/settings.ts` were chosen, and how to redo the measurement.

```bash
npm run calibrate   # score the labelled cases with the real model
npm run sweep       # re-derive the thresholds from scratch
npm run e2e         # load the built extension in Chrome and watch it fire
```

`scripts/calibration-cases.mjs` holds 42 labelled cases: 20 genuine study videos and 22
distractions, each with a title and a channel name. The off-topic half deliberately
over-samples what people actually drift to, including music videos titled after a person,
which score higher than you would expect against any topic.

Two error types, not equally bad:

- **False alarm** — a genuine study video gets interrupted. This is what makes people
  uninstall a focus tool, so it is weighted about twice as heavily.
- **Miss** — a distraction plays without a reminder. Mildly disappointing, not harmful.

## Bug 1: the threshold was far too high

Scoring the raw topic against the raw title at 0.30 flagged **7 of 15** genuinely on-topic
study videos. Nearly half of all correct study sessions would have been interrupted.

The off-topic side of that original estimate was about right. The on-topic side was far too
optimistic: real study titles cluster between 0.15 and 0.55, not above 0.60.

**Embedding the topic as a phrase** fixed most of it. Comparing `studying AWS certification`
against the title, rather than `AWS certification`, puts the topic in the same register as a
video title and separates the two classes much more cleanly.

| Variant | Best threshold | False alarms | Misses |
| --- | --- | --- | --- |
| Raw topic vs title | 0.115 | 1/15 | 1/15 |
| `a video about <topic>` | 0.140 | 1/15 | 5/15 |
| Both templated | 0.340 | 2/15 | 2/15 |
| **`studying <topic>`** | **0.140** | **1/15** | **0/15** |

## Bug 2: combining title and channel with max()

The first version scored a video as `max(titleScore, channelScore)`. Taking the best of two
noisy signals raises the floor for everything, because an unrelated channel name still draws
a random score.

This was caught by `npm run e2e`, which loads the real extension and opens a real video.
Against the topic `AWS certification`, *Never Gonna Give You Up* scored:

| Signal | Score |
| --- | --- |
| Title | 0.142 |
| Channel ("Rick Astley") | 0.137 |
| `max()` | 0.142 |
| Threshold at the time | 0.140 |

The card never appeared. The music video was judged on-topic by 0.002, entirely on noise.

**The fix** gives each signal its own bar. A video is left alone when *any one* of three
independent checks says it belongs, so each can only ever rescue a video, never condemn one:

1. the title clears the sensitivity threshold, or
2. the channel clears a separate, much higher bar, or
3. the title or channel literally repeats the topic's words.

The channel bar is high because the signal is noisy. Across the labelled set:

| | Off-topic channels | A genuine channel rescue |
| --- | --- | --- |
| Range | -0.05 to 0.21 | 0.89 ("AWS Training and Certification") |

Anything from 0.25 to 0.50 separates those cleanly. The shipped bar is **0.35**, with margin
on both sides. Under the new rule Rick Astley is correctly flagged: title 0.142 is below
0.15, and channel 0.137 is nowhere near 0.35.

## Bug 3: the literal word check

Embeddings are weak on acronyms. *LeetCode 101: Two Sum explained* scores 0.057 against
`studying Python DSA`, lower than most genuinely unrelated videos, because the model has no
useful representation of "DSA" or "LeetCode". `src/lib/lexical.ts` suppresses a reminder when
at least half the topic's content words appear literally in the title or channel, which
rescues the common form of this failure (*Python DSA roadmap 2025*). It can only prevent a
reminder, never trigger one.

## Shipped thresholds

Channel bar 0.35, across 20 on-topic and 22 off-topic cases:

| Sensitivity | Title threshold | False alarms | Misses |
| --- | --- | --- | --- |
| Relaxed | 0.12 | 1/20 | 3/22 |
| Balanced (default) | 0.15 | 1/20 | 1/22 |
| Strict | 0.24 | 3/20 | 0/22 |

The classes genuinely overlap and no threshold separates them perfectly. At balanced, the
one remaining false alarm is the LeetCode case above, and the one miss is *My morning routine
vlog* against `machine learning`, which scores 0.220 on pure noise. Catching that would cost
three false alarms, which is the wrong trade.

## Measured in a real service worker

The same code running inside a genuine `ServiceWorkerGlobalScope` on the WebAssembly backend,
which is the environment the extension actually uses.

| | |
| --- | --- |
| Cold model load, including the 23 MB download | 9.7 s |
| Warm check, one title plus one channel | 243 ms |
| Full round trip from the content script, cold | 5 to 13 s |

## Caveats

Forty-two hand-written cases is a small set, chosen to span common study topics and common
distractions. It is enough to show that 0.30 was badly miscalibrated and that `max()` was
wrong, but it is not a benchmark. If a topic behaves badly for you, add the case to
`scripts/calibration-cases.mjs`, run `npm run sweep`, and adjust.

Changing `topicPrompt` in `src/lib/similarity.ts` or switching models invalidates every
number here.
