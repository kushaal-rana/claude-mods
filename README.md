# claude-mods

Mods for the [Claude Code](https://claude.com/claude-code) desktop app: plugins that add new features to the Code tab. Built and used daily by Kushaal Rana.

| Mod | What it does |
| :---- | :---- |
| [🎙 live-voice](#-live-voice) | Talk with Claude out loud. It reads Claude's answers in a natural voice, and you can talk over it to pause, ask a question or give a command. |
| [🔔 chime](#-chime) | A soft sound when Claude finishes a longer reply, and a different one when Claude needs your answer or OK. |
| [📊 usage-card](#-usage-card) | A card above the prompt with your context, every limit and when it resets, and the session's time and cost, plus a short pill in the bottom bar. |
| [🤖 subagents](#-subagents) | A live, colorful card for each subagent Claude starts: the step it's on, its progress, tokens and time. |
| [🧩 mod-manager](#-mod-manager) | `/mods` shows every mod you have, what it does and how to use it, with an on/off switch for each. |

## Install

Add this repo as a plugin marketplace, then install the mods you want:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install live-voice@kushaal-mods
```

```bash
claude plugin install chime@kushaal-mods
```

```bash
claude plugin install usage-card@kushaal-mods
```

```bash
claude plugin install subagents@kushaal-mods
```

```bash
claude plugin install mod-manager@kushaal-mods
```

live-voice also needs its small audio helper, built once on your Mac (about three minutes):

```bash
git clone https://github.com/kushaal-rana/claude-mods.git
claude-mods/plugins/live-voice/scripts/install-helper.sh
```

Then open a new chat, or type `/reload-plugins` in an open one. `/plugin` doesn't run inside the desktop app, so run these commands in a terminal.

**Requirements:** a recent Claude Code (tested on 2.1.317). live-voice also needs macOS 26 on Apple Silicon and Apple's command line tools for building the helper (`xcode-select --install`). chime needs macOS.

## Mods

### 🎙 live-voice

Press **🎙 Talk** in the prompt's bottom bar and Claude's answers are read to you in a natural voice that runs on your Mac. Talk over it any time, like a call with the same Claude that's doing the work.

- Reads only Claude's final answer, never the progress lines in between, either retold for listening or word for word. Code and tables become a short "have a look on screen".
- Talk to interrupt: it pauses within a quarter second, carries on after an "mm-hmm", and sends real questions to Claude after a 1.6-second Cancel window. Say "continue" to pick up where it stopped.
- Voice commands: continue, wait, slower, faster, go back, skip, repeat, read from the part about…, catch me up, never mind.
- A card above the prompt with live captions, speed from 1x to 2x, six voices (Everly by default), Catch me up and Read selection.
- Fully local audio: Phonon and Kokoro voices, Apple's on-device speech recognition and echo cancellation. Only your questions reach Claude, as text.

Full guide and troubleshooting: [plugins/live-voice/README.md](plugins/live-voice/README.md).

### 🔔 chime

Look away while Claude works, and a sound tells you it's done. A different tone means Claude is waiting on you.

- Glass plays when a reply took 15 seconds or more. Quick replies, interrupted replies and subagents stay quiet.
- iMessage's question tone plays when Claude asks you something, has a plan to approve, or needs a permission.
- Give a chat its own sound with `/chime sound tink here`, so you can tell by ear which chat finished.
- Quiet during a live-voice chat, so the microphone never hears it.
- `/chime` shows the settings and every command: on and off, the threshold, and 16 sounds that ship with macOS.

Full guide: [plugins/chime/README.md](plugins/chime/README.md).

### 📊 usage-card

See how much of your context and usage limits a chat has used, without asking.

- A pill beside the model picker shows the context, then the 5-hour limit (*38% · 12%*). It fits beside live-voice's Voice on.
- A card above the message box, open in every chat: context with tokens used, the 5-hour and weekly limits with when they reset, and the session's length and API-price cost.
- Meters turn orange at 70% and red at 90%. **Hide** closes the card for that chat, and the pill or `/usage-card` brings it back.
- Refreshes every 5 seconds and after every reply. It reads only the session's own figures and sends nothing anywhere.

Full guide: [plugins/usage-card/README.md](plugins/usage-card/README.md).

### 🤖 subagents

Watch each subagent work. A side pane opens by itself the first time Claude starts one in a chat.

- One card per subagent in its own color: the task, agent type and model, and the step it's on right now (*Reading README.md*).
- A bar that moves while it works, then turns green when it's done, red if it failed, or gray if it was stopped.
- Tool calls, tokens and time on each card, and the chat's cost so far at the top.
- `/subagents` opens or closes the pane, and **Clear finished** tidies it.

Full guide: [plugins/subagents/README.md](plugins/subagents/README.md).

### 🧩 mod-manager

Every mod you have, in one place, with a switch for each.

- `/mods` opens a pane with a colorful card per mod: what it does, how to use it, its version and where it came from.
- A green **On** or gray **Off** switch runs Claude Code's own enable or disable. New chats get the change, and `/reload-plugins` applies it in an open chat.
- Mods from any marketplace show up by themselves. Plugins that aren't mods, like skills or connectors, stay out.

Full guide: [plugins/mod-manager/README.md](plugins/mod-manager/README.md).

## Updating

```bash
claude plugin marketplace update kushaal-mods
```

```bash
claude plugin update live-voice@kushaal-mods
```

```bash
claude plugin update chime@kushaal-mods
```

```bash
claude plugin update usage-card@kushaal-mods
```

```bash
claude plugin update subagents@kushaal-mods
```

```bash
claude plugin update mod-manager@kushaal-mods
```

## Versions and rolling back

Every release is tagged `<mod>-v<version>` (for example `live-voice-v1.0.0`) and listed in [CHANGELOG.md](CHANGELOG.md). To bring an earlier version back in a working copy:

```bash
git tag --list 'live-voice-v*'
git checkout live-voice-v1.0.0 -- plugins/live-voice
```

Then `/reload-plugins` in an open chat. Commit the result to keep it, or return to the latest with `git checkout main -- plugins/live-voice`.

## Turning a mod off

```bash
claude plugin disable live-voice@kushaal-mods
```

New chats then start without it. `claude plugin enable live-voice@kushaal-mods` brings it back.

## Working on these mods

Each mod is a folder under [`plugins/`](plugins) with `.claude-plugin/plugin.json`, `hooks/hooks.json`, its hooks module (`hooks/register.tsx`) and, when it keeps state, `types/index.d.ts`, and it is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

To run mods straight from a working copy, add the clone itself as the marketplace (`claude plugin marketplace add /path/to/claude-mods`). Edits then load with `/reload-plugins`, with no reinstall.

The release routine for any change:

1. Check the mod with `claude plugin validate plugins/<mod>`, and try it in the app.
2. Bump `version` in `plugins/<mod>/.claude-plugin/plugin.json` and add a CHANGELOG entry.
3. Commit, tag `<mod>-v<version>`, and push with tags.

## License

[MIT](LICENSE)
