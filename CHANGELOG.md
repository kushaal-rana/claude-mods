# Changelog

Each release is tagged `<mod>-v<version>` in git.

## live-voice 1.0.0 (2026-11-06)

First release.

- Reads Claude's final answer aloud, never the progress lines between tool calls, in a natural voice that runs on the Mac. Everly is the default; Hadley, Miles, Heart, Michael and Emma are in the voice menu.
- Two reading styles: a spoken retelling written by the same Claude in the same chat (default), or word for word. Code blocks and tables become a short "have a look on screen".
- Hands-free: talk over it and it pauses within a quarter second. "Mm-hmm", "okay" or a cough lets it carry on from the exact spot. A question is shown for 1.6 seconds with Cancel, then sent to Claude; "continue" goes back to the interrupted reading.
- Voice commands: continue, wait, stop, slower, faster, repeat, go back, skip, read from the part about…, catch me up, never mind, stop listening, turn off the voice chat.
- Card above the prompt with live captions, speed from 1x to 2x, voice picker, mute, Read last answer, Catch me up and Read selection.
- 🎙 Talk button in the prompt's bottom bar. Voice is off in every chat until it's pressed.
- Helper program: Phonon and Kokoro voices on the CPU, Apple's on-device speech recognition, Apple's echo cancellation, Silero voice detection. Nothing but the questions themselves leaves the Mac.
