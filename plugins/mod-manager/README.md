# mod-manager

Every mod you have installed, in one place. `/mods` opens a pane with a colorful card per mod: what it does, how to use it, and a switch to turn it on or off.

## Using it

- **`/mods`** opens the pane, and closes it again.
- **Each card** shows the mod's name and emoji, what it does, how to use it (its button or slash commands), its version and where it was installed from.
- **The switch** turns a mod on (green) or off (gray) for every chat. New chats start with the change; in a chat that's already open, `/reload-plugins` applies it there too.
- **The mod manager** itself has no switch, so the pane can't turn itself off. `claude plugin disable mod-manager@kushaal-mods` in a terminal does.
- **Mods from anywhere** show up by themselves, from any marketplace. One the manager doesn't know is described by its own manifest, with the slash commands its code registers. Plugins that aren't mods, such as skills or connectors, stay out.

## How it works

One hooks module (`hooks/register.tsx`) with its state contract in `types/index.d.ts`:

- It reads Claude Code's list of installed plugins (`plugins/installed_plugins.json` in the Claude config folder) and keeps the ones whose `hooks/hooks.json` lists hooks modules: those are mods.
- On or off comes from `enabledPlugins` in your settings, read with `$.settings.read()`.
- A switch runs Claude Code's own command, `claude plugin enable` or `claude plugin disable`, with the app's own `claude` program, at the scope the mod was installed at.
- While the pane is open it looks again every 5 seconds, so a mod installed or switched in a terminal shows up.

**What it runs on your computer:** `claude plugin enable` and `claude plugin disable`, only when you press a switch. It sends nothing anywhere.

## Installing it

In a terminal:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install mod-manager@kushaal-mods
```

Then open a new chat, or type `/reload-plugins` in an open one.

## Checking it

```bash
claude plugin validate plugins/mod-manager
claude plugin test plugins/mod-manager
```

The tests in `hooks/mods.test.ts` cover the list on the desktop and in the terminal (mods only, in order), switching a mod off and on, a switch that fails, the manager's own card, an empty list, and the command.
