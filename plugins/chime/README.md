# chime

A soft sound when Claude finishes a reply that took a while, so you can look away while it works. A different tone plays when Claude needs you: a question, a plan to approve, or a permission prompt.

## Using it

- **Replies:** Glass plays when a reply took 15 seconds or more. Quicker replies stay quiet, since you were probably still watching. Interrupted replies and subagents never chime.
- **When Claude needs you:** iMessage's question tone plays as a question or plan-approval dialog opens, and for a permission prompt where the app reports one.
- **During a voice chat:** quiet while a live-voice chat is running, so its microphone never hears the chime and pauses the reading.
- **Commands:**
  - `/chime` shows the current settings.
  - `/chime on`, `/chime off`, `/chime test`.
  - `/chime after 30` chimes only for replies that take 30 seconds or more. `/chime after 0` chimes after every reply.
  - `/chime sound hero` changes the reply sound. `/chime ask-sound ping` changes the "needs you" sound. Picking a sound plays it once.
  - `/chime sound tink here` gives this chat a reply sound of its own, so you can tell by ear which chat finished. Other chats keep the default, and the chat keeps its sound when you reopen it. `/chime sound default here` goes back to the default. A `/clear` starts a fresh conversation, which uses the default again.
  - `/chime ask off` stops the "needs you" sound. `/chime voice on` lets it chime during voice chats too.
- **Sounds:** `message` and `question` (iMessage's tones), or one of macOS's `basso`, `blow`, `bottle`, `frog`, `funk`, `glass`, `hero`, `morse`, `ping`, `pop`, `purr`, `sosumi`, `submarine`, `tink`.

Settings are remembered across chats.

## How it works

One hooks module (`hooks/register.tsx`):

- `turn.complete` in the main conversation plays the reply sound when the turn ran past the threshold and wasn't interrupted.
- `tool.call` on `AskUserQuestion` and `ExitPlanMode` plays the "needs you" sound as the dialog opens. `classic.Notification` with `permission_prompt` does the same for permission prompts.
- Sounds play with macOS's `afplay`, from files that ship with macOS (`/System/Library/Sounds` and iMessage's tones), so the mod carries no audio.
- Settings live in the mod's store. A chat's own sound is kept there under the chat's session id; the 200 most recent are kept.
- Before playing, it runs `pgrep -f claude-voice-helper` to see whether a live-voice chat is running. A voice chat in any open chat keeps Chime quiet.

**What it runs on your computer:** `afplay` and `pgrep`. It reads nothing else and sends nothing anywhere.

## Installing it

In a terminal:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install chime@kushaal-mods
```

Then open a new chat, or type `/reload-plugins` in an open one. It needs macOS.

## Checking it

```bash
claude plugin validate plugins/chime
claude plugin test plugins/chime
```

The tests in `hooks/chime.test.ts` cover the threshold, interrupted replies and subagents, the voice-chat quiet, the commands and the "needs you" tone.
