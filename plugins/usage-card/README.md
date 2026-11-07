# usage-card

See how much of your context and usage limits a chat has used, without asking. A card above the message box shows the full picture in every chat, and a small pill in the prompt's bottom bar shows the context and the 5-hour limit at a glance.

## Using it

- **The pill** sits in the bottom bar beside the model picker: *38% · 12%* is the context, then the 5-hour limit. It's kept short so it fits beside live-voice's "🎙 Voice on". It shows "Usage" until the first reading comes in, and *Ctx 38%* when your plan reports no limits.
- **The card** is open above the message box in every chat, in even columns:
  - **Context:** how full the context window is, with a meter, and tokens used out of the window.
  - **5-hour limit** and **Weekly limit:** how much of each is used, and when it resets (a countdown within a day, a day and time within the week, a date beyond that).
  - **Session:** how long this chat has run, and what it would have cost at API prices (*API ≈ $…*; plans like Max don't charge this).
- **Meters** are green, turn orange at 70% and red at 90%.
- **Hide** closes the card in this chat only; the next chat opens it again. Click the pill to bring it back. There's no Compact button by design: the card only reports.
- `/usage-card` toggles the card in this chat, and `/usage-card on` and `/usage-card off` set it.

The figures refresh every 5 seconds and after every reply.

## How it works

One hooks module (`hooks/register.tsx`) with its state contract in `types/index.d.ts`:

- `$.session.usage()` gives the context window, the rate-limit windows from the last API response, the session's cost and when it started. A 5-second `$.clock.every` timer and `turn.complete` read it; the pill and card only redraw when a figure changes.
- The pill is drawn at the `SessionMode` render site. It draws whatever else is there first (the mode labels, live-voice's 🎙 Talk button), then adds itself.
- The card is drawn at `AbovePrompt`, under anything another mod draws there. It steps aside while a survey holds that band.
- `/usage-card` is a registered command.

**What it runs on your computer:** nothing. It reads the session's own usage figures and sends nothing anywhere.

## Installing it

In a terminal:

```bash
claude plugin marketplace add https://github.com/kushaal-rana/claude-mods.git
```

```bash
claude plugin install usage-card@kushaal-mods
```

Then open a new chat, or type `/reload-plugins` in an open one.

## Checking it

```bash
claude plugin validate plugins/usage-card
claude plugin test plugins/usage-card
```

The tests in `hooks/usage.test.ts` cover the pill label (with and without limits), the card open in a new chat, the card on the desktop and in the terminal, Hide and the pill bringing it back, and the command.
