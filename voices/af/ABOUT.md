# Naluno's African voice

- **Voice:** `sw.onnx` is the Piper voice *sw_CD-lanfrica-medium*: one Kiswahili
  speaker (a Bantu voice, East/Central Africa), 22,050 Hz. It was fine-tuned
  by the Piper project from its U.S. English *lessac* voice on the
  **Kiswahili TTS Dataset** from Lanfrica (https://lanfrica.com/record/kiswahili-tts-dataset).
  The recordings come from a Kiswahili audio Bible.
- **Copy used:** the ONNX file from the sherpa-onnx project's GitHub release
  (`vits-piper-sw_CD-lanfrica-medium`). Naluno reduced its weights to 8-bit
  (63 MB → 19 MB) so it can be uploaded to GitHub and downloaded by phones.
- **Licence of the recordings:** "The authors permit use for non-profit,
  educational, and public benefit purposes." Check that Naluno's use fits
  this before charging for anything that uses this voice, or ask Lanfrica.
- **Piper** (the model design and software): MIT licence.
- **Female voice:** made on the phone from the same speaker (pitch raised
  ×1.65, voice tract ×1.12, js/naluno-af-engine.js). There is no open female
  East African voice yet.
