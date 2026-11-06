# live-voice

Talk with Claude Code out loud. Press 🎙 Talk in the prompt's bottom bar and Claude's answers are read to you in a natural voice that runs on your Mac. Talk over it any time to pause it, ask a question or give a command, like a voice call with the same Claude that's doing the work.

## Using it

- **Start and stop:** the 🎙 Talk button in the prompt's bottom bar (it reads "🎙 Voice on" while active), or `/talk` and `/talk off`. Voice is off in every chat until you start it.
- **What it reads:** only Claude's final answer for each turn, never the progress lines in between. By default the same Claude retells it for listening ("Style: spoken"); "Style: word for word" reads the text itself. Code blocks and tables become a short note to look at the screen.
- **Talking to it:** just speak. The reading pauses within a quarter second. "Mm-hmm", "okay" or a cough lets it carry on from the exact spot. A question shows on the card for 1.6 seconds with **Cancel** and **Send now**, then goes into the chat as your message; Claude says "Let me check", answers, and the answer is read aloud. Say "continue" to go back to where it stopped.
- **Voice commands:** continue, wait, stop, slower, faster, repeat (say that again), go back, skip, read from the part about…, catch me up, never mind, stop listening, turn off the voice chat.
- **The card** (above the prompt while voice is on): status, live captions of what it hears, the sentence being read with its neighbours dimmed, Pause/Resume/Stop, Mute mic, speed (1x to 2x), End, Read last answer, Catch me up, Read selection (select text in the chat first), the reading style and the voice.

Speed, voice and style are remembered across chats.

## How it works

Two parts:

1. **The mod** (`hooks/`, TypeScript). It takes Claude's final answer from `turn.complete`, turns markdown into speakable sentences (`speech.ts`), and asks the same Claude for a spoken retelling or a catch-up with `$.model.fork`, which adds nothing to the chat. Spoken questions go in with `$.prompt.submit`, with a hidden note telling Claude it was asked out loud. Voice commands are parsed locally (`voicecmd.ts`). It draws the 🎙 Talk button at the `SessionMode` site and the card at `AbovePrompt`.
2. **The helper** (`helper/`, Swift), started by the mod while voice is on in a chat and stopped with it. It speaks with FluidAudio's Phonon and Kokoro voices on the CPU, listens through one AVAudioEngine with Apple's echo cancellation (so it doesn't hear itself on the speakers), detects speech with Silero every 256 ms, and transcribes with Apple's on-device `SpeechTranscriber`. The mod talks to it over a private Unix socket (`POST /cmd`, JSON) and reads its events as JSON lines on stdout.

## Installing the helper

```bash
plugins/live-voice/scripts/install-helper.sh
```

It needs Apple's command line tools and takes about three minutes the first time. The voice and speech-detection models download on first use (about 260 MB). The first time the mic turns on, macOS asks to let Claude use the microphone.

Files on disk, all under `~/.claude-voice/`: `bin/claude-voice-helper`, `models/`, `build/`, and `run/` (the socket and `helper.log`).

## Troubleshooting

- **The card says the helper crashed or stopped:** read `~/.claude-voice/run/helper.log`; a line starting `UNCAUGHT` carries Apple's own error message. Press Restart on the card.
- **It never hears you:** check System Settings > Privacy & Security > Microphone and allow `claude`.
- **"Echo cancellation isn't available":** it fell back to the plain mic, so it may hear itself on the speakers. Headphones fix that.
- **It reacts to other people or a video in the room:** press Mute mic. Questions still wait 1.6 seconds with Cancel before reaching Claude.
- **Faster startup or Neural Engine:** the helper runs on the CPU by default. `--compute auto` exists, but the Neural Engine route made Core ML abort when the app started the helper (2026-11-06).
- **Echo cancellation order:** on this MacBook Air, Apple's voice processing only starts if the speaker output is wired up before it is switched on (error -10875 otherwise). `Audio.swift` does this.

## Privacy

Everything audio-related runs on the Mac. What reaches Claude is your question as text, the same as typing it. The spoken retelling and the catch-up are extra requests to the same Claude, so they use a little of your Claude usage; "word for word" uses none.
