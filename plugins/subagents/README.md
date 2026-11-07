# subagents

See what each subagent is doing while Claude works. A side pane shows one colorful live card per subagent: its task, the step it's on, a moving progress bar, and its tool calls, tokens and time.

## Using it

- **The pane opens by itself** the first time Claude starts a subagent in a chat. Close it and it stays closed for that chat; `/subagents` opens it again.
- **Each card** wears its own color and shows:
  - the task in Claude's words, with the agent type and model (*Explore · Sonnet 5.5*)
  - the step it's on right now (*Reading README.md*, *Searching for "TODO"*)
  - a bar that moves while it works, then turns green when it's done, red if it failed, or gray if it was stopped
  - its tool calls, the tokens of its latest request, and how long it has run
- **The top of the pane** counts the working and finished subagents and shows what the whole chat has cost so far at API prices.
- **Clear finished** (or `/subagents clear`) removes the finished cards.

## How it works

One hooks module (`hooks/register.tsx`) with its state contract in `types/index.d.ts`:

- `agent.spawn` adds a card when a subagent starts. The subagent's own `tool.call`s carry its id, and each one becomes the step on its card.
- `turn.step` reads the model and token count of each of its model requests, and `turn.complete` marks it done, failed or stopped.
- Every few seconds `$.agent.list()` is checked too, for a subagent that ended without a word.
- The pane is drawn at the `Pane` render site. Its bars are SVG on the desktop and block characters in the terminal, and they only move while the pane is open and a subagent is working.

**What it runs on your computer:** nothing. It reads the session's own events and sends nothing anywhere.

## Installing it

In a terminal:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install subagents@kushaal-mods
```

Then open a new chat, or type `/reload-plugins` in an open one.

## Checking it

```bash
claude plugin validate plugins/subagents
claude plugin test plugins/subagents
```

The tests in `hooks/subagents.test.ts` cover the pane opening by itself once, the step on a card, main-thread calls staying out, done, failed and stopped cards, an agent seen before its spawn, the terminal's bars, clearing, and the command.
