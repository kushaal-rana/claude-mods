# break-reminder

A nudge to step away from the screen. A ☕ pill in the bottom bar counts down to your next break, and when it's time you get a "Take a break" toast, a soft sound and a few seconds of bubbles drifting up above the message box.

## Using it

- **The pill:** *☕ 12m* sits in the prompt's bottom bar, beside the model picker and any other mod's buttons. It reads *☕ Break time* for a minute after a reminder. Click it when you've just had a break and the clock starts over.
- **The reminder:** every 15 minutes of work by default. It's a toast that says ☕ Take a break, Aurora's soft tone, and bubbles with a few sparkles floating up a strip above the message box for about 8 seconds. If you're in another app, a Mac banner says it too.
- **Then it starts again:** each reminder restarts the clock, so the next one comes 15 minutes later.
- **Time away counts as a break:** 10 minutes with no message in any chat, and the clock starts fresh when you're back. No reminders fire while you're away.
- **One clock for all your chats:** every open chat shows the same countdown and the toast, and the sound plays once, not once per chat.
- **During a voice chat:** quiet while a live-voice chat is running, so its microphone never hears the tone. The toast and the bubbles still show.
- **Commands:**
  - `/break` shows the time to your next break and the settings.
  - `/break every 30` sets how often, in minutes. 15, 30 and 45 all work, or any number from 1 to 240.
  - `/break test` shows and plays the reminder now, and says what each part did. The clock carries on.
  - `/break restart` starts the clock over, like clicking the pill.
  - `/break sound milestone` changes the sound and plays it once. `/break sound off` and `/break sound on` turn it off and on.
  - `/break bubbles off` and `/break bubbles on`.
  - `/break off` turns the reminders and the pill off. `/break on` brings them back with a fresh clock.
- **Sounds:** `aurora` (the default), `bamboo`, `chord`, `circles`, `complete`, `hello`, `keys`, `note`, `popcorn`, `pulse`, `synth`, `cheers`, `droplet`, `milestone`, `welcome`, and macOS's `glass`, `hero`, `ping`, `purr`, `tink`.

Settings are remembered across chats.

## How it works

One hooks module (`hooks/register.tsx`):

- The clock lives in the mod's store, so every chat on the Mac reads the same one: when this stretch of work began, your last message in any chat, and the last reminder.
- `prompt.submit` and `turn.complete` mark you as active, for messages you type, send from your phone or speak through live-voice. Scheduled tasks, other Claude sessions and background notifications don't count as your work.
- Each chat checks the clock every 5 seconds and redraws the pill (`ui.render` on `SessionMode`). When a break is due, the first chat to notice restarts the clock under its own id. Every chat that sees the restart shows the toast, and only the chat whose restart still stands a moment later plays the sound and the banner.
- The bubbles are an animated SVG. The mod first asks the app to draw them behind the whole window (`$.ui.backdrop`). Today's desktop app doesn't draw backdrops, so they float up a strip above the message box instead (`ui.render` on `AbovePrompt`), under whatever other mods draw there. Once the app supports backdrops, the full-window version takes over by itself.
- Sounds play with macOS's `afplay`, from tones that ship with macOS, so the mod carries no audio.
- Before playing, it runs `pgrep -f claude-voice-helper` to see whether a live-voice chat is running. It checks which app is in front with `lsappinfo`, and shows the banner with `osascript`.

**What it runs on your computer:** `afplay`, `pgrep`, `lsappinfo` and `osascript`. It reads nothing else and sends nothing anywhere.

## Installing it

In a terminal:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install break-reminder@kushaal-mods
```

Then open a new chat, or type `/reload-plugins` in an open one. The sound and the banner need macOS, and the bubbles need the desktop app.

## Checking it

```bash
claude plugin validate plugins/break-reminder
claude plugin test plugins/break-reminder
```

The tests in `hooks/break.test.ts` cover the countdown, the reminder and its restart, time away, the shared clock across chats, the voice-chat quiet, the banner, the bubbles in both places, and the commands.
