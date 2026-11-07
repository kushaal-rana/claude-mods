# Changelog

Each release is tagged `<mod>-v<version>` in git.

## usage-card 1.0.0 (2026-11-06)

First release.

- A pill in the prompt's bottom bar, beside the model picker, with the context and the 5-hour limit (*38% · 12%*). It's kept short to fit beside live-voice's "🎙 Voice on".
- Clicking the pill opens a card above the message box: context with tokens used, the 5-hour and weekly limits with when they reset, and the session's length and API-price cost.
- Meters turn orange at 70% and red at 90%. The card has one button, Hide, and only reports.
- `/usage-card` toggles the card. Open or closed is remembered across chats. Figures refresh every 5 seconds and after every reply.

## chime 1.0.0 (2026-11-06)

First release.

- Glass plays when a reply took 15 seconds or more. Quicker replies, interrupted replies and subagents stay quiet.
- iMessage's question tone plays when Claude needs you: a question, a plan to approve or a permission prompt.
- Quiet during a live-voice chat, so its microphone never hears the chime.
- `/chime` commands for on and off, test, the threshold, the reply and "needs you" sounds, and a sound of a chat's own (`/chime sound tink here`).
- 16 sounds, all shipped with macOS, so the mod carries no audio.

## live-voice 1.0.0 (2026-11-06)

First release.

- Reads Claude's final answer aloud, never the progress lines between tool calls, in a natural voice that runs on the Mac. Everly is the default; Hadley, Miles, Heart, Michael and Emma are in the voice menu.
- Two reading styles: a spoken retelling written by the same Claude in the same chat (default), or word for word. Code blocks and tables become a short "have a look on screen".
- Hands-free: talk over it and it pauses within a quarter second. "Mm-hmm", "okay" or a cough lets it carry on from the exact spot. A question is shown for 1.6 seconds with Cancel, then sent to Claude; "continue" goes back to the interrupted reading.
- Voice commands: continue, wait, stop, slower, faster, repeat, go back, skip, read from the part about…, catch me up, never mind, stop listening, turn off the voice chat.
- Card above the prompt with live captions, speed from 1x to 2x, voice picker, mute, Read last answer, Catch me up and Read selection.
- 🎙 Talk button in the prompt's bottom bar. Voice is off in every chat until it's pressed.
- Helper program: Phonon and Kokoro voices on the CPU, Apple's on-device speech recognition, Apple's echo cancellation, Silero voice detection. Nothing but the questions themselves leaves the Mac.
