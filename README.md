# claude-mods

Kushaal's mods for the Claude desktop app's Code tab. Each mod is a folder under `plugins/`, listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) under the marketplace name `kushaal-mods`.

## Mods

| Mod | Version | What it does |
| :---- | :---- | :---- |
| [live-voice](plugins/live-voice) | 1.0.0 | Talk with Claude out loud. A 🎙 Talk button in the prompt's bottom bar starts it; Claude's answers are read in a natural local voice, and you can talk over it to pause, ask a question or give a command. |

## Install

This repo is private, so the computer needs GitHub access first: `gh auth login`, then `gh auth setup-git`.

On Kushaal's Mac the mods are read straight from this folder, so what is in git is what runs:

```bash
claude plugin marketplace add "/Users/kushaalrana/Documents/Claude Cowork OS/My Plugins/claude-mods"
claude plugin install live-voice@kushaal-mods --scope user
```

On another computer, from GitHub:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
claude plugin install live-voice@kushaal-mods
```

Some mods also need a helper program. For live-voice, run `plugins/live-voice/scripts/install-helper.sh` once.

`/plugin` doesn't run inside the desktop app, so run these in a terminal. Chats that are already open pick up an install or a change with `/reload-plugins`.

## Changing a mod

1. Edit the files in `plugins/<mod>/`, then check them with `claude plugin validate plugins/<mod>`.
2. Try the change in the app (`/reload-plugins` in an open chat).
3. Bump `version` in `plugins/<mod>/.claude-plugin/plugin.json` and add an entry to [CHANGELOG.md](CHANGELOG.md).
4. Commit, tag the release `<mod>-v<version>` (for example `live-voice-v1.0.1`) and push with tags.

## Rolling back

Every release is tagged, so any earlier version can come back:

```bash
git tag --list 'live-voice-v*'
git checkout live-voice-v1.0.0 -- plugins/live-voice
```

Then `/reload-plugins` in an open chat. Commit the result to keep the rollback, or undo it with `git checkout main -- plugins/live-voice`.

## Turning a mod off

```bash
claude plugin disable live-voice@kushaal-mods
```

New chats then start without it. `claude plugin enable` brings it back.

## Adding a mod

Each mod is a folder under `plugins/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, its hooks module (`hooks/register.tsx`) and, when it keeps state, `types/index.d.ts`. Add an entry for it to `.claude-plugin/marketplace.json`, give it a README, and run `claude plugin validate` on both the mod folder and the repo root before the first commit.
