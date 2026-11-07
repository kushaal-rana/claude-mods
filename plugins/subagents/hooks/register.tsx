import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Helper, Phase } from '../types'

const helpers = atom({ plugin: 'subagents', key: 'helpers' } as const, [])
const clock = atom({ plugin: 'subagents', key: 'clock' } as const, { tick: 0, now: 0 })
const hasAutoOpened = atom({ plugin: 'subagents', key: 'hasAutoOpened' } as const, false)
const chatCost = atom({ plugin: 'subagents', key: 'chatCost' } as const, null)

const PANE = 'subagents'
const TITLE = 'Subagents'
// The bars move on every tick while a subagent works and the pane is open.
const TICK_MS = 400
// Every few ticks the engine's own list of agents is checked, for one stopped without a word.
const SYNC_EVERY = 5
// Past this many cards the oldest finished ones go.
const MAX_HELPERS = 30
// An agent the engine has dropped from its list, this long after it started, has ended.
const GONE_AFTER_MS = 10_000

// Eight card colors, bright on a dark pane and deep enough on a light one.
export const HUES = ['#8B5CF6', '#EC4899', '#0EA5E9', '#F59E0B', '#10B981', '#F97316', '#6366F1', '#14B8A6'] as const
const DONE = '#34C759'
const FAILED = '#FF453A'
const STOPPED = '#8E8E93'
const SPIN = ['◐', '◓', '◑', '◒']

// "claude-sonnet-5-5" reads "Sonnet 5.5"; a date after the number is left off.
export const modelName = (id: string) => {
  const match = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)

  if (match === null) {
    return id
  }

  const family = match[1] ?? ''

  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${match[2] ?? ''}${match[3] === undefined ? '' : `.${match[3]}`}`
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
const short = (value: string, max = 44) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)
const baseName = (path: unknown) => {
  const value = text(path)

  return value === undefined ? 'a file' : (value.split('/').pop() ?? value)
}

// What a tool call is doing, in a few plain words.
export const describeStep = (tool: string, args: Record<string, unknown>) => {
  switch (tool) {
    case 'Read':
      return `Reading ${baseName(args.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${baseName(args.file_path)}`
    case 'NotebookEdit':
      return `Editing ${baseName(args.notebook_path)}`
    case 'Write':
      return `Writing ${baseName(args.file_path)}`
    case 'Bash': {
      const description = text(args.description)

      return description === undefined ? 'Running a command' : short(description)
    }
    case 'Grep': {
      const pattern = text(args.pattern)

      return pattern === undefined ? 'Searching files' : `Searching for "${short(pattern, 28)}"`
    }
    case 'Glob':
      return 'Finding files'
    case 'WebSearch': {
      const query = text(args.query)

      return query === undefined ? 'Searching the web' : `Searching the web for ${short(query, 30)}`
    }
    case 'WebFetch':
      return 'Reading a web page'
    case 'Agent':
    case 'Task':
      return `Starting a helper: ${short(text(args.description) ?? 'subagent', 32)}`
    case 'Skill': {
      const skill = text(args.skill)

      return skill === undefined ? 'Using a skill' : `Using ${skill}`
    }
    case 'TodoWrite':
      return 'Updating its to-do list'
    case 'ToolSearch':
      return 'Loading tools'
    default: {
      // mcp__server__search_threads reads "Using search threads".
      const name = tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool

      return `Using ${name.replace(/[_-]+/g, ' ')}`
    }
  }
}

export const span = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  return minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const tokenCount = (count: number) =>
  count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1_000 ? `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k` : `${count}`

// A moving piece while it works; full and green when done, red when it failed, half and gray when stopped.
export const barSvg = (width: number, phase: Phase, hue: string, tick: number) => {
  const parts = [`<rect width="${width}" height="8" rx="4" fill="#8E8E93" fill-opacity="0.22"/>`]

  if (phase === 'running') {
    const piece = Math.round(width * 0.3)
    const step = Math.max(6, Math.round(width / 16))
    // The bright head enters on the left and leaves on the right, a fainter tail behind it.
    const head = (tick * step) % (width + piece)

    parts.push(
      `<rect x="${head - piece}" width="${Math.round(piece * 0.55)}" height="8" rx="4" fill="${hue}" fill-opacity="0.35"/>`,
      `<rect x="${head - Math.round(piece * 0.6)}" width="${Math.round(piece * 0.6)}" height="8" rx="4" fill="${hue}"/>`,
    )
  } else {
    const color = phase === 'done' ? DONE : phase === 'failed' ? FAILED : STOPPED
    parts.push(`<rect width="${phase === 'stopped' ? Math.round(width / 2) : width}" height="8" rx="4" fill="${color}"/>`)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">${parts.join('')}</svg>`
}

// The terminal's bar, in block characters.
export const barText = (phase: Phase, tick: number, size = 20) => {
  if (phase === 'running') {
    const piece = 5
    const start = (tick % (size + piece)) - piece

    return Array.from({ length: size }, (_, index) => (index >= start && index < start + piece ? '█' : '░')).join('')
  }

  return phase === 'stopped' ? `${'█'.repeat(size / 2)}${'░'.repeat(size / 2)}` : '█'.repeat(size)
}

// A color no card on show wears yet, else one no working card wears.
const pickHue = (list: readonly Helper[]) => {
  const worn = new Set(list.map(one => one.hue))
  const unworn = HUES.findIndex((_, index) => !worn.has(index))

  if (unworn !== -1) {
    return unworn
  }

  const working = new Set(list.filter(one => one.phase === 'running').map(one => one.hue))
  const free = HUES.findIndex((_, index) => !working.has(index))

  return free === -1 ? list.length % HUES.length : free
}

const change = async ($: EngineInterface, id: string, fn: (helper: Helper) => Helper) => {
  if ((await read($, helpers)).some(one => one.id === id)) {
    await update($, helpers, list => list.map(one => (one.id === id ? fn(one) : one)))
  }
}

const addHelper = async ($: EngineInterface, id: string, task: string, type: string, model: string) => {
  const now = await $.clock.now()

  await update($, helpers, list => {
    if (list.some(one => one.id === id)) {
      return list.map(one => (one.id === id ? { ...one, task: task || one.task, type: type || one.type, model: model || one.model } : one))
    }

    const kept: Helper[] = [
      ...list,
      { id, task: task || 'Subagent', type, model, phase: 'running', step: 'Starting', tools: 0, tokens: 0, startedAt: now, hue: pickHue(list) },
    ]

    while (kept.length > MAX_HELPERS) {
      const oldest = kept.findIndex(one => one.phase !== 'running')

      if (oldest === -1) {
        break
      }

      kept.splice(oldest, 1)
    }

    return kept
  })
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE)

const refreshCost = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  const cost = usage.cost?.usd ?? null

  if ((await read($, chatCost)) !== cost) {
    await update($, chatCost, () => cost)
  }
}

const openPane = async ($: EngineInterface) => {
  await refreshCost($).catch(() => {})

  return $.ui.open({ id: PANE, title: TITLE })
}

// Once a chat, the first subagent opens the pane.
const autoOpen = async ($: EngineInterface) => {
  if ((await read($, hasAutoOpened)) || (await isOpen($))) {
    return
  }

  await update($, hasAutoOpened, () => true)
  const opened = await openPane($)

  if (!opened.isPlaced) {
    $.ui.toast('A subagent started. /subagents shows its live card.')
  }
}

// A tool call from a loop not seen yet: a card if the engine lists it as an agent.
const ensureHelper = async ($: EngineInterface, id: string) => {
  if ((await read($, helpers)).some(one => one.id === id)) {
    return true
  }

  const agent = (await $.agent.list()).find(one => one.id === id)

  if (agent === undefined) {
    return false
  }

  await addHelper($, id, agent.description || agent.name || agent.type, agent.type, '')
  await autoOpen($)

  return true
}

const ENDED: Partial<Record<string, Phase>> = { completed: 'done', failed: 'failed', killed: 'stopped' }

// The engine's word on agents that ended without a turn.complete reaching this mod.
const sync = async ($: EngineInterface) => {
  const list = await read($, helpers)

  if (!list.some(one => one.phase === 'running')) {
    return
  }

  const [agents, now] = await Promise.all([$.agent.list(), $.clock.now()])
  let isChanged = false
  const next = list.map(one => {
    if (one.phase !== 'running') {
      return one
    }

    const agent = agents.find(listed => listed.id === one.id)
    const phase = agent === undefined ? (now - one.startedAt > GONE_AFTER_MS ? 'done' : undefined) : ENDED[agent.status]

    if (phase === undefined) {
      return one
    }

    isChanged = true

    return { ...one, phase, step: '', endedAt: now }
  })

  if (isChanged) {
    await update($, helpers, () => next)
  }
}

// Module variables start over on a reload; the cards live in the session's state.
let ticks = 0

const tick = async ($: EngineInterface) => {
  if (!(await read($, helpers)).some(one => one.phase === 'running')) {
    return
  }

  ticks += 1

  if (ticks % SYNC_EVERY === 0) {
    await sync($)
  }

  if (await isOpen($)) {
    if (ticks % SYNC_EVERY === 0) {
      await refreshCost($)
    }

    const now = await $.clock.now()
    await update($, clock, current => ({ tick: current.tick + 1, now }))
  }
}

const clearFinished = ($: EngineInterface) => update($, helpers, list => list.filter(one => one.phase === 'running'))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'subagents',
      description: 'Show or hide the Subagents pane: a live card for each subagent',
      argumentHint: '[clear]',
      immediate: true,
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))

    return started
  })

  on('command.run', { command: 'subagents' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'clear') {
      await clearFinished($)

      return { text: 'Cleared the finished subagents.' }
    }

    if (await isOpen($)) {
      await $.ui.close({ id: PANE })

      return { text: 'Subagents pane closed. `/subagents` opens it again.' }
    }

    const opened = await openPane($)
    const count = (await read($, helpers)).length

    if (!opened.isPlaced) {
      return { text: 'The Subagents pane opens as soon as the window has room for it.' }
    }

    return { text: count === 0 ? 'Subagents pane opened. A card shows up for each subagent Claude starts.' : 'Subagents pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)

    if (started.agentId !== undefined) {
      await addHelper($, started.agentId, text(e.description) ?? e.subagentType, e.subagentType, modelName(started.model ?? '')).catch(() => {})
      await autoOpen($).catch(() => {})
    }

    return started
  })

  // A subagent's own tool calls carry its id: each one is the step it's on.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId

    if (id !== undefined) {
      try {
        if (await ensureHelper($, id)) {
          const step = describeStep(e.tool, e as unknown as Record<string, unknown>)
          await change($, id, one => ({ ...one, step, tools: one.tools + 1, phase: 'running', endedAt: undefined }))
        }
      } catch {
        // A card that can't update keeps its last step.
      }
    }

    return next(e)
  })

  // Each model request of a subagent: its model, and the tokens it read and wrote.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId
    const usage = result.usage

    if (id !== undefined && usage !== null) {
      const model = modelName(usage.model || e.model)
      const used = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      await change($, id, one => ({ ...one, model: model || one.model, tokens: used })).catch(() => {})
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId

    if (id !== undefined) {
      const phase: Phase = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      const now = await $.clock.now()
      await change($, id, one => ({ ...one, phase, step: '', endedAt: now })).catch(() => {})
      void refreshCost($).catch(() => {})
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // The terminal has no Svg: its bars are block characters.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg
    const [list, { tick: frame }, cost, now] = await Promise.all([read($, helpers), read($, clock), read($, chatCost), $.clock.now()])
    const columns = Math.max(24, e.props.bodyColumns)
    const barWidth = Math.max(80, Math.min(420, (columns - 6) * 7))
    const working = list.filter(one => one.phase === 'running')
    const finished = list.filter(one => one.phase !== 'running').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))

    const card = (one: Helper) => {
      const hue = HUES[one.hue % HUES.length] ?? HUES[0]
      const color = one.phase === 'running' ? hue : one.phase === 'done' ? DONE : one.phase === 'failed' ? FAILED : STOPPED
      const glyph = one.phase === 'running' ? (SPIN[frame % SPIN.length] ?? '●') : one.phase === 'done' ? '✓' : one.phase === 'failed' ? '✕' : '■'
      const time = span((one.endedAt ?? now) - one.startedAt)
      const status =
        one.phase === 'running' ? `Working · ${time}` : one.phase === 'done' ? `Done in ${time}` : one.phase === 'failed' ? `Failed after ${time}` : `Stopped after ${time}`
      const kind = [one.type, one.model].filter(Boolean).join(' · ')
      const line =
        one.phase === 'running' ? one.step || 'Starting' : one.phase === 'done' ? 'Finished its task' : one.phase === 'failed' ? 'Ran into an error' : 'Was stopped'

      return (
        <Box key={`card-${one.id}`} flexDirection="column" borderStyle="round" borderColor={hue} paddingX={1} marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" gap={1}>
            <Box flexShrink={1}>
              <Text bold color={hue} wrap="truncate-end">
                {`${glyph} ${one.task}`}
              </Text>
            </Box>
            <Text color={color}>{status}</Text>
          </Box>
          {kind === '' ? null : (
            <Text dimColor wrap="truncate-end">
              {kind}
            </Text>
          )}
          <Text wrap="truncate-end">{line}</Text>
          {Svg === undefined ? <Text color={color}>{barText(one.phase, frame)}</Text> : <Svg source={barSvg(barWidth, one.phase, hue, frame)} alt={status} />}
          <Text dimColor>{`${one.tools} tool call${one.tools === 1 ? '' : 's'} · ${tokenCount(one.tokens)} tokens`}</Text>
        </Box>
      )
    }

    const summary = list.length === 0 ? '' : [working.length > 0 ? `${working.length} working` : '', finished.length > 0 ? `${finished.length} finished` : ''].filter(Boolean).join(' · ')

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>🤖 Subagents</Text>
          <Text dimColor>{summary}</Text>
        </Box>
        {cost === null ? null : <Text dimColor>{`This chat so far: API ≈ $${cost.toFixed(2)}`}</Text>}
        {list.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              No subagents yet. A card shows up here for each one Claude starts, with the step it's on.
            </Text>
          </Box>
        ) : null}
        {[...working, ...finished].map(card)}
        {finished.length > 0 ? (
          <Box marginTop={1}>
            <Button key="clear" label="Clear finished" variant="secondary" onPress={() => void clearFinished($)} />
          </Box>
        ) : null}
      </Box>
    )
  })
}
