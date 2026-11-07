import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Limit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-card', key: 'snapshot' } as const, null)
// Open in every chat. Hide closes it for this chat only: the next chat opens it again.
const isOpen = atom({ plugin: 'usage-card', key: 'isOpen' } as const, true)

const REFRESH_MS = 5_000

const LIMIT_LABELS: Record<string, string> = { five_hour: '5-hour limit', seven_day: 'Weekly limit', spend_limit: 'Spend limit' }

// Fine, getting full, nearly out.
const LEVEL_COLORS = { ok: '#34C759', warn: '#FF9F0A', high: '#FF453A' } as const
export const level = (percent: number) => (percent >= 90 ? 'high' : percent >= 70 ? 'warn' : 'ok')

export const tokens = (count: number) =>
  count >= 1_000_000
    ? `${+(count / 1_000_000).toFixed(count % 1_000_000 === 0 ? 0 : 1)}M`
    : count >= 1_000
      ? `${Math.round(count / 1_000)}k`
      : `${count}`

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const span = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60_000))

  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const clockTime = (date: Date) => {
  const hours = date.getHours()
  const minutes = date.getMinutes()

  return `${hours % 12 || 12}${minutes === 0 ? '' : `:${String(minutes).padStart(2, '0')}`} ${hours < 12 ? 'AM' : 'PM'}`
}

// Within a day: "resets in 3h 20m"; within a week: "resets Mon 5 AM"; further out: "resets Nov 12".
export const resetText = (iso: string, now: number) => {
  const date = new Date(iso)
  const ms = date.getTime() - now

  if (Number.isNaN(ms)) {
    return undefined
  }

  if (ms < 24 * 3_600_000) {
    return `resets in ${span(ms)}`
  }

  if (ms < 6 * 24 * 3_600_000) {
    return `resets ${DAYS[date.getDay()]} ${clockTime(date)}`
  }

  return `resets ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

// The bottom-bar pill, kept short so it fits beside live-voice's "Voice on": "24% · 56%" is context, then the 5-hour
// limit. "Ctx 24%" alone before the plan reports any limit, "Usage" before the first reading.
export const pillLabel = (data: Snapshot | null) => {
  if (data === null) {
    return 'Usage'
  }

  const context = data.contextPercent === undefined ? '—' : `${data.contextPercent}%`
  const first = data.limits.find(limit => limit.kind === 'five_hour') ?? data.limits[0]

  return first === undefined ? `Ctx ${context}` : `${context} · ${Math.round(first.percentUsed)}%`
}

const meterSvg = (percent: number) => {
  const width = 96
  const fill = Math.max(0, Math.min(width, (width * percent) / 100))

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="6" viewBox="0 0 ${width} 6">`,
    `<rect width="${width}" height="6" rx="3" fill="#8E8E93" fill-opacity="0.28"/>`,
    fill > 0 ? `<rect width="${Math.max(fill, 6)}" height="6" rx="3" fill="${LEVEL_COLORS[level(percent)]}"/>` : '',
    '</svg>',
  ].join('')
}

const meterText = (percent: number) => {
  const clamped = Math.max(0, Math.min(100, percent))
  // Any use at all shows at least one block.
  const filled = clamped > 0 ? Math.max(1, Math.round(clamped / 10)) : 0

  return { filled: '█'.repeat(filled), empty: '░'.repeat(10 - filled) }
}

const refresh = async ($: EngineInterface) => {
  const [usage, now] = await Promise.all([$.session.usage(), $.clock.now()])
  const next: Snapshot = {
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    contextPercent: usage.context.percent,
    limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    costUsd: usage.cost?.usd,
    startedAt: usage.startedAt,
    at: Math.floor(now / 60_000) * 60_000,
  }

  // Only a real change redraws the pill and the card.
  if (JSON.stringify(await read($, snapshot)) !== JSON.stringify(next)) {
    await update($, snapshot, () => next)
  }
}

const setOpen = ($: EngineInterface, shown: boolean) => update($, isOpen, () => shown)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'usage-card',
      description: 'Show or hide the usage card above the message box in this chat',
      argumentHint: '[on|off]',
      immediate: true,
    })
    // A first reading that fails still leaves the timer running: the pill fills in on its next tick.
    await refresh($).catch(() => {})
    $.clock.every(REFRESH_MS, () => void refresh($).catch(() => {}))

    return started
  })

  on('command.run', { command: 'usage-card' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const shown = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOpen))
    await setOpen($, shown)

    return { text: shown ? 'Usage card shown.' : 'Usage card hidden in this chat. The pill in the bottom bar or `/usage-card` brings it back.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($).catch(() => {})

    return done
  })

  // The pill in the prompt's bottom bar, after whatever else draws there (the mode labels, live-voice's Talk button).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const beside = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const data = await read($, snapshot)
    const shown = await read($, isOpen)

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        {beside}
        <Button key="usage-pill" label={pillLabel(data)} variant={shown ? 'primary' : undefined} onPress={() => void setOpen($, !shown)} />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // What other mods draw here stays, above the card.
    const above = await next(e)
    const data = await read($, snapshot)

    if (e.props.hasSurvey || data === null || !(await read($, isOpen))) {
      return above
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    // The terminal has no Svg: its meters are block characters.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg

    const meter = (percent: number) => {
      if (Svg === undefined) {
        const { filled, empty } = meterText(percent)

        return (
          <Text>
            <Text color={LEVEL_COLORS[level(percent)]}>{filled}</Text>
            <Text dimColor>{empty}</Text>
          </Text>
        )
      }

      return <Svg source={meterSvg(percent)} alt={`${Math.round(percent)}% used`} />
    }

    // One column: a label, a reading, and a line of detail. Columns share the width evenly.
    const tile = (key: string, label: string, reading: RenderChildren[], detail: string) => (
      <Box key={key} flexDirection="column" flexGrow={1} width={0} minWidth={16}>
        <Text color="subtle" wrap="truncate-end">
          {label}
        </Text>
        <Box flexDirection="row" alignItems="center" gap={1}>
          {reading.filter(Boolean)}
        </Box>
        <Text color="subtle" wrap="truncate-end">
          {detail}
        </Text>
      </Box>
    )

    const contextTile =
      data.contextPercent === undefined
        ? tile('context', 'Context', [<Text bold>—</Text>], `${tokens(data.contextWindow)} window`)
        : tile(
            'context',
            'Context',
            [meter(data.contextPercent), <Text bold>{`${data.contextPercent}%`}</Text>],
            `${tokens(data.contextTokens ?? 0)} of ${tokens(data.contextWindow)} tokens`,
          )

    const limitTiles = data.limits.map((limit: Limit) =>
      tile(
        `limit-${limit.kind}`,
        LIMIT_LABELS[limit.kind] ?? limit.kind,
        [meter(limit.percentUsed), <Text bold>{`${Math.round(limit.percentUsed)}%`}</Text>],
        (limit.resetsAt === undefined ? undefined : resetText(limit.resetsAt, data.at)) ?? ' ',
      ),
    )

    const sessionTile = tile(
      'session',
      'Session',
      [<Text bold>{span(data.at - data.startedAt)}</Text>],
      data.costUsd === undefined ? ' ' : `API ≈ $${data.costUsd.toFixed(2)}`,
    )

    const hide = <Button key="hide" label="Hide" variant="secondary" onPress={() => void setOpen($, false)} />

    return (
      <Box flexDirection="column">
        {above}
        <Box flexDirection="row" alignItems="center" columnGap={3} paddingX={1}>
          {[contextTile, ...limitTiles, sessionTile, hide]}
        </Box>
      </Box>
    )
  })
}
