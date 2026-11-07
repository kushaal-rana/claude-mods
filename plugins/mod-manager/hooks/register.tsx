import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ModRow } from '../types'

const mods = atom({ plugin: 'mod-manager', key: 'mods' } as const, [])
const busy = atom({ plugin: 'mod-manager', key: 'busy' } as const, '')
const note = atom({ plugin: 'mod-manager', key: 'note' } as const, '')
const isLoaded = atom({ plugin: 'mod-manager', key: 'isLoaded' } as const, false)

const PANE = 'mods'
const TITLE = 'Mods'
const SELF = 'mod-manager'
// While the pane is open it looks again this often, for a mod installed or switched elsewhere.
const POLL_MS = 5_000

const ON = '#34C759'
const OFF = '#8E8E93'
const ACCENTS = ['#8B5CF6', '#EC4899', '#0EA5E9', '#F59E0B', '#10B981', '#F97316', '#6366F1', '#14B8A6'] as const

type Known = { emoji: string; title: string; what: string; usage: string; accent: string }

// Kushaal's own mods in words that fit a card, in this order. A mod from anywhere else follows,
// A to Z, with its own description and the slash commands its code registers.
const KNOWN: Record<string, Known> = {
  'live-voice': {
    emoji: '🎙',
    title: 'Live Voice',
    what: 'Talk with Claude out loud. It reads the answers, and you can talk over it to pause or ask.',
    usage: 'Press 🎙 Talk in the bottom bar, or type /talk',
    accent: '#8B5CF6',
  },
  chime: {
    emoji: '🔔',
    title: 'Chime',
    what: 'A sound when a longer reply finishes, and another when Claude needs you.',
    usage: '/chime shows its settings · /chime test plays it',
    accent: '#F59E0B',
  },
  'usage-card': {
    emoji: '📊',
    title: 'Usage Card',
    what: 'Context, usage limits and what the chat cost, above the message box.',
    usage: 'Click the pill in the bottom bar, or type /usage-card',
    accent: '#0EA5E9',
  },
  'break-reminder': {
    emoji: '☕',
    title: 'Break Reminder',
    what: 'Reminds you to step away and take a break while you work.',
    usage: 'The ☕ pill in the bottom bar · /break',
    accent: '#F97316',
  },
  subagents: {
    emoji: '🤖',
    title: 'Subagents',
    what: 'A live card for each subagent: the step it is on, its progress, tokens and time.',
    usage: 'Opens by itself when Claude starts a subagent · /subagents',
    accent: '#EC4899',
  },
  'mod-manager': {
    emoji: '🧩',
    title: 'Mod Manager',
    what: 'This pane: every mod you have, what it does, and its on/off switch.',
    usage: '/mods opens or closes it',
    accent: '#10B981',
  },
}
const KNOWN_ORDER = Object.keys(KNOWN)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const short = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

export const titleCase = (name: string) =>
  name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')

// The same name always gets the same color.
export const accentOf = (name: string) => {
  let sum = 0

  for (const char of name) {
    sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % 9973
  }

  return ACCENTS[sum % ACCENTS.length] ?? ACCENTS[0]
}

// The slash commands a mod's code registers: `command.register({ name: 'x' ...`.
export const commandsIn = (source: string) => {
  const found: string[] = []

  for (const match of source.matchAll(/command\.register\(\s*\{\s*name:\s*['"`]([^'"`]+)['"`]/g)) {
    const name = match[1]

    if (name !== undefined && !found.includes(name)) {
      found.push(name)
    }
  }

  return found
}

const readText = async ($: EngineInterface, path: string) => {
  try {
    return String(await $.fs.read(path))
  } catch {
    return undefined
  }
}

const readJson = async ($: EngineInterface, path: string): Promise<unknown> => {
  const raw = await readText($, path)

  if (raw === undefined) {
    return undefined
  }

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

// Where Claude Code keeps its files: CLAUDE_CONFIG_DIR when set, else ~/.claude.
const configDir = async ($: EngineInterface) => (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`

// One installed plugin, as a row, if it is a mod: a plugin whose hooks.json lists hooks modules.
const inspect = async ($: EngineInterface, id: string, record: Record<string, unknown>, enabled: Record<string, unknown>): Promise<ModRow | undefined> => {
  const installPath = typeof record.installPath === 'string' ? record.installPath : ''
  const hooks = await readJson($, `${installPath}/hooks/hooks.json`)

  if (installPath === '' || !isObject(hooks) || !Array.isArray(hooks.modules)) {
    return undefined
  }

  const manifest = await readJson($, `${installPath}/.claude-plugin/plugin.json`)
  const [plainName = id, marketplace = ''] = id.split('@')
  const name = isObject(manifest) && typeof manifest.name === 'string' ? manifest.name : plainName
  const description = isObject(manifest) && typeof manifest.description === 'string' ? manifest.description : ''
  const version = isObject(manifest) && typeof manifest.version === 'string' ? manifest.version : typeof record.version === 'string' ? record.version : ''
  const known = KNOWN[name]
  let usage = known?.usage ?? ''

  if (known === undefined) {
    const sources = await Promise.all(
      hooks.modules.filter((module): module is string => typeof module === 'string').map(module => readText($, `${installPath}/hooks/${module.replace(/^\.\//, '')}`)),
    )
    const commands = commandsIn(sources.join('\n')).map(command => `/${command}`)
    usage = commands.length === 0 ? 'No slash command: it works on its own' : commands.join(' · ')
  }

  return {
    id,
    name,
    marketplace,
    scope: typeof record.scope === 'string' ? record.scope : 'user',
    ...(typeof record.projectPath === 'string' ? { projectPath: record.projectPath } : {}),
    version,
    emoji: known?.emoji ?? '🧩',
    title: known?.title ?? titleCase(name),
    what: known?.what ?? description,
    usage,
    accent: known?.accent ?? accentOf(name),
    // Claude Code writes false for a switched-off plugin.
    isOn: enabled[id] !== false,
    isSelf: name === SELF,
  }
}

// Every installed mod: Kushaal's own first, in their order, then the rest A to Z.
const scan = async ($: EngineInterface): Promise<ModRow[]> => {
  const [installed, settings] = await Promise.all([readJson($, `${await configDir($)}/plugins/installed_plugins.json`), $.settings.read().catch(() => ({}))])
  const enabled = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  const plugins = isObject(installed) && isObject(installed.plugins) ? installed.plugins : {}
  const rows: ModRow[] = []

  for (const [id, records] of Object.entries(plugins)) {
    const list = Array.isArray(records) ? records.filter(isObject) : []
    // A user-scope install first: it is the one every chat loads.
    const record = list.find(one => one.scope === 'user') ?? list[0]

    if (record !== undefined) {
      const row = await inspect($, id, record, enabled)

      if (row !== undefined && !rows.some(one => one.name === row.name)) {
        rows.push(row)
      }
    }
  }

  const rank = (row: ModRow) => {
    const index = KNOWN_ORDER.indexOf(row.name)

    return index === -1 ? KNOWN_ORDER.length : index
  }

  return rows.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
}

const refresh = async ($: EngineInterface) => {
  const rows = await scan($)

  if (JSON.stringify(await read($, mods)) !== JSON.stringify(rows)) {
    await update($, mods, () => rows)
  }

  if (!(await read($, isLoaded))) {
    await update($, isLoaded, () => true)
  }
}

const isOpen = async ($: EngineInterface) => (await $.ui.panes()).some(pane => pane.id === PANE)

// Claude Code's own switch: `claude plugin enable|disable`, run with the app's own claude.
const toggle = async ($: EngineInterface, row: ModRow) => {
  if (row.isSelf || (await read($, busy)) !== '') {
    return
  }

  const verb = row.isOn ? 'disable' : 'enable'
  await update($, busy, () => row.id)

  try {
    const claude = (await $.env.get('CLAUDE_CODE_EXECPATH')) ?? 'claude'
    const ran = await $.process.run([claude, 'plugin', verb, row.id, '--scope', row.scope], {
      timeoutMs: 60_000,
      ...(row.projectPath === undefined ? {} : { cwd: row.projectPath }),
    })

    if (ran.exitCode === 0) {
      await update($, note, () =>
        row.isOn
          ? `${row.title} is off. New chats start without it; in a chat already open, /reload-plugins turns it off there too.`
          : `${row.title} is on. New chats start with it; in a chat already open, /reload-plugins turns it on there too.`,
      )
    } else {
      const reason = (ran.stderr.trim() || ran.stdout.trim()).split('\n')[0] ?? ''
      await update($, note, () => `Couldn't turn ${row.title} ${row.isOn ? 'off' : 'on'}${reason === '' ? '.' : `: ${short(reason, 100)}`}`)
    }
  } catch {
    await update($, note, () => `Couldn't run Claude Code's plugin command to switch ${row.title}.`)
  } finally {
    await update($, busy, () => '')
    await refresh($).catch(() => {})
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'mods', description: 'Show or hide the Mods pane: every mod, what it does, and its on/off switch', immediate: true })
    $.clock.every(POLL_MS, () => {
      void (async () => {
        if (await isOpen($)) {
          await refresh($)
        }
      })().catch(() => {})
    })

    return started
  })

  on('command.run', { command: 'mods' }, async $ => {
    if (await isOpen($)) {
      await $.ui.close({ id: PANE })

      return { text: 'Mods pane closed. `/mods` opens it again.' }
    }

    await refresh($).catch(() => {})
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return { text: opened.isPlaced ? 'Mods pane opened.' : 'The Mods pane opens as soon as the window has room for it.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const [list, busyId, message, loaded] = await Promise.all([read($, mods), read($, busy), read($, note), read($, isLoaded)])
    const onCount = list.filter(row => row.isOn).length

    const card = (row: ModRow) => {
      const color = row.isOn ? row.accent : OFF
      const control = row.isSelf ? (
        <Text color={ON}>Always on</Text>
      ) : busyId === row.id ? (
        <Text dimColor>Switching…</Text>
      ) : (
        <Button key={`toggle-${row.name}`} onPress={() => void toggle($, row)}>
          {row.isOn ? (
            <Text color={ON} bold>
              ● On
            </Text>
          ) : (
            <Text dimColor>○ Off</Text>
          )}
        </Button>
      )

      return (
        <Box key={`mod-${row.name}`} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
            <Box flexShrink={1}>
              <Text bold color={row.isOn ? row.accent : undefined} dimColor={!row.isOn} wrap="truncate-end">
                {`${row.emoji} ${row.title}`}
              </Text>
            </Box>
            {control}
          </Box>
          {row.what === '' ? null : (
            <Text dimColor={!row.isOn} wrap="wrap">
              {row.what}
            </Text>
          )}
          <Text dimColor italic wrap="wrap">
            {`How to use: ${row.usage}`}
          </Text>
          <Text dimColor wrap="truncate-end">
            {[row.version === '' ? '' : `v${row.version}`, row.marketplace].filter(Boolean).join(' · ')}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text bold>🧩 Mods</Text>
          <Text dimColor>{list.length === 0 ? '' : `${onCount} on · ${list.length - onCount} off`}</Text>
        </Box>
        <Text dimColor wrap="wrap">
          A switch applies to new chats. In a chat already open, /reload-plugins applies it.
        </Text>
        {loaded && list.length === 0 ? (
          <Box marginTop={1}>
            <Text dimColor wrap="wrap">
              No mods installed yet. Mods you install from any marketplace show up here by themselves.
            </Text>
          </Box>
        ) : null}
        {list.map(card)}
        {message === '' ? null : (
          <Box marginTop={1}>
            <Text color={ON} wrap="wrap">
              {message}
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
