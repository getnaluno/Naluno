# GitHub update — 2026.09.08d

Spark now treats Luganda like every other language on the live
translators, with the Luganda book as an extra first look-up.

## Open sources wired in

- **English Wiktionary** (CC BY-SA 3.0) — 100+ real Luganda lemmas
  from Category:Luganda_lemmas (`amazzi`, `omwana`, `ekitabo`…).
  Credit stays on the Spark Luganda book.
- **Lingva** (already in the engine) — confirmed Luganda both ways
  (`hello` → `Nkulamusizza`, `Amazzi` → `Water`). Unknown sentences
  fall through to this, same as Swahili or Arabic.
- **Taught words** still win over Wiktionary. Seed greetings still win
  over both.

Not used: *Enkuluze y’Oluganda Olw’ennono* (copyrighted print book),
LibreTranslate.com (API key), PanLex from this machine (DNS).

## Languages added

Kinyarwanda, isiZulu, Hausa, Yorùbá, Igbo, Urdu, Bangla, Tagalog,
Indonesian, Malay, Vietnamese, Thai, Italian, Dutch, Polish,
Ukrainian, Swedish, Romanian — grouped in the Spark language list.

Copy over, hard-reload the app, open Spark, pick Luganda. A known
word (water) should come from the book. A new sentence should come
through in Luganda the same way a French sentence would.
