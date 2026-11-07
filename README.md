# claude-mods

Mods for the [Claude Code](https://claude.com/claude-code) desktop app: plugins that add new features to the Code tab. Built and used daily by Kushaal Rana.

| Mod | What it does |
| :---- | :---- |
| [🎙 live-voice](#-live-voice) | Talk with Claude out loud. It reads Claude's answers in a natural voice, and you can talk over it to pause, ask a question or give a command. |

More are on the way: a completion chime and a session usage card.

## Install

Add this repo as a plugin marketplace, then install the mods you want:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install live-voice@kushaal-mods
```

live-voice also needs its small audio helper, built once on your Mac (about three minutes):

```bash
git clone https://github.com/kushaal-rana/claude-mods.git
claude-mods/plugins/live-voice/scripts/install-helper.sh
```

Then open a new chat, or type `/reload-plugins` in an open one. `/plugin` doesn't run inside the desktop app, so run these commands in a terminal.

**Requirements:** macOS 26 on Apple Silicon, a recent Claude Code (tested on 2.1.317), and Apple's command line tools for building the helper (`xcode-select --install`).

## Mods

### 🎙 live-voice

Press **🎙 Talk** in the prompt's bottom bar and Claude's answers are read to you in a natural voice that runs on your Mac. Talk over it any time, like a call with the same Claude that's doing the work.

- Reads only Claude's final answer, never the progress lines in between, either retold for listening or word for word. Code and tables become a short "have a look on screen".
- Talk to interrupt: it pauses within a quarter second, carries on after an "mm-hmm", and sends real questions to Claude after a 1.6-second Cancel window. Say "continue" to pick up where it stopped.
- Voice commands: continue, wait, slower, faster, go back, skip, repeat, read from the part about…, catch me up, never mind.
- A card above the prompt with live captions, speed from 1x to 2x, six voices (Everly by default), Catch me up and Read selection.
- Fully local audio: Phonon and Kokoro voices, Apple's on-device speech recognition and echo cancellation. Only your questions reach Claude, as text.

Full guide and troubleshooting: [plugins/live-voice/README.md](plugins/live-voice/README.md).

## Updating

```bash
claude plugin marketplace update kushaal-mods
```

```bash
claude plugin update live-voice@kushaal-mods
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
