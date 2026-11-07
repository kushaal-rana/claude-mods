import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { Pill } from '../types'

const pill = atom({ plugin: 'break-reminder', key: 'pill' } as const, null)
// While a reminder's bubbles float up the strip above the message box: when they end. 0 when they aren't showing.
const stripUntil = atom({ plugin: 'break-reminder', key: 'stripUntil' } as const, 0)

const MINUTE = 60_000
// How often each chat checks the shared clock and redraws its pill.
const TICK_MS = 5_000
// After a reminder, the pill reads "Break time" this long before the countdown comes back.
const BREAK_TIME_MS = 60_000
// How long the bubbles drift across the window.
const EFFECT_MS = 8_000
// After claiming a reminder, how long to wait before checking that no other chat claimed the same one.
const CLAIM_SETTLE_MS = 1_500
export const TOAST = '☕ Take a break'

const TONES = '/System/Library/PrivateFrameworks/ToneLibrary.framework/Versions/A/Resources/AlertTones'
const SYSTEM_SOUNDS = '/System/Library/Sounds'

// All ship with macOS, so the mod carries no audio. Aurora is the default: soft, and unlike Chime's sounds.
export const SOUNDS: Record<string, string> = {
  ...Object.fromEntries(
    ['Aurora', 'Bamboo', 'Chord', 'Circles', 'Complete', 'Hello', 'Keys', 'Note', 'Popcorn', 'Pulse', 'Synth'].map(name => [
      name.toLowerCase(),
      `${TONES}/Modern/${name}.m4r`,
    ]),
  ),
  ...Object.fromEntries(['Cheers', 'Droplet', 'Milestone', 'Welcome'].map(name => [name.toLowerCase(), `${TONES}/EncoreInfinitum/${name}-EncoreInfinitum.caf`])),
  ...Object.fromEntries(['Glass', 'Hero', 'Ping', 'Purr', 'Tink'].map(name => [name.toLowerCase(), `${SYSTEM_SOUNDS}/${name}.aiff`])),
}

export type Settings = {
  isOn: boolean
  everyMinutes: number
  // This long with no message in any chat counts as a break: the clock starts over.
  awayMinutes: number
  sound: string
  isSoundOn: boolean
  // The bubbles behind the chat (desktop app only).
  isEffectOn: boolean
  // No sound while a live-voice chat runs, so its microphone never hears it.
  isQuietDuringVoice: boolean
}

export const DEFAULTS: Settings = {
  isOn: true,
  everyMinutes: 15,
  awayMinutes: 10,
  sound: 'aurora',
  isSoundOn: true,
  isEffectOn: true,
  isQuietDuringVoice: true,
}

// One clock for every chat on this Mac, kept in the store. `workStart` is when this stretch of work began,
// `lastActive` your last message (or the reply to it) in any chat, `remindedAt` and `remindedBy` the last reminder
// and the chat that played its sound.
export type BreakClock = { workStart: number; lastActive: number; remindedAt: number; remindedBy: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const freshClock = (now: number): BreakClock => ({ workStart: now, lastActive: now, remindedAt: 0, remindedBy: '' })

const loadSettings = async ($: EngineInterface): Promise<Settings> => {
  const saved = await $.store.get('settings')

  return { ...DEFAULTS, ...(isRecord(saved) ? (saved as Partial<Settings>) : {}) }
}

const loadClock = async ($: EngineInterface, now: number): Promise<BreakClock> => {
  const saved = await $.store.get('clock')

  return isRecord(saved) && typeof saved.workStart === 'number' ? { ...freshClock(now), ...(saved as Partial<BreakClock>) } : freshClock(now)
}

// This chat's writes to the shared clock go one at a time, each reading the latest first.
let writing: Promise<unknown> = Promise.resolve()

const changeClock = ($: EngineInterface, now: number, change: (latest: BreakClock) => BreakClock | undefined): Promise<BreakClock> => {
  const run = writing.then(async () => {
    const latest = await loadClock($, now)
    const changed = change(latest)

    if (changed !== undefined) {
      await $.store.set('clock', changed)
    }

    return changed ?? latest
  })
  writing = run.catch(() => {})

  return run
}

// "12m", "1h 5m". Rounded up, so it never reads 0m before the break is due.
export const countdown = (ms: number) => {
  const total = Math.max(1, Math.ceil(ms / MINUTE))

  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`
}

// Where this stretch of work stands. Time away means a fresh stretch, starting now.
export const stretch = (clock: BreakClock, settings: Settings, now: number) => {
  const isAway = now - clock.lastActive >= settings.awayMinutes * MINUTE
  const start = isAway ? now : clock.workStart

  return { isAway, remaining: settings.everyMinutes * MINUTE - (now - start) }
}

export const pillFor = (clock: BreakClock, settings: Settings, now: number): Pill | null => {
  if (!settings.isOn) {
    return null
  }

  // Just reminded, and nobody has restarted the clock since.
  if (clock.remindedAt > 0 && clock.workStart === clock.remindedAt && now - clock.remindedAt < BREAK_TIME_MS) {
    return { label: '☕ Break time', isBreakTime: true }
  }

  return { label: `☕ ${countdown(stretch(clock, settings, now).remaining)}`, isBreakTime: false }
}

const setPill = async ($: EngineInterface, next: Pill | null) => {
  // Only a real change redraws the bottom bar.
  if (JSON.stringify(await read($, pill)) !== JSON.stringify(next)) {
    await update($, pill, () => next)
  }
}

const play = async ($: EngineInterface, sound: string) => {
  try {
    await $.process.run(['/usr/bin/afplay', SOUNDS[sound] ?? SOUNDS.aurora ?? ''], { timeoutMs: 15_000 })
  } catch {
    // Not a Mac, or the sound file is missing: stay quiet.
  }
}

// live-voice's helper runs only while a voice chat is on.
const isVoiceChatOn = async ($: EngineInterface) => {
  try {
    const { exitCode } = await $.process.run(['/usr/bin/pgrep', '-f', 'claude-voice-helper'], { timeoutMs: 3_000 })

    return exitCode === 0
  } catch {
    return false
  }
}

// The app this chat shows in, by the name the Dock gives it.
const TERMINAL_APPS: Record<string, string> = {
  Apple_Terminal: 'Terminal',
  'iTerm.app': 'iTerm2',
  vscode: 'Code',
  ghostty: 'Ghostty',
  WarpTerminal: 'Warp',
}

const hostApp = async ($: EngineInterface) => {
  const surface = await $.session.surface()

  if (surface === 'desktop') {
    return 'Claude'
  }

  return surface === 'terminal' ? TERMINAL_APPS[(await $.env.get('TERM_PROGRAM')) ?? ''] : undefined
}

const frontApp = async ($: EngineInterface) => {
  try {
    const { stdout } = await $.process.run(['/bin/sh', '-c', 'lsappinfo info -only name "$(lsappinfo front)"'], { timeoutMs: 5_000 })

    return /"LSDisplayName"="(.*)"/.exec(stdout)?.[1]
  } catch {
    return undefined
  }
}

// In another app, the toast can't be seen, so a Mac banner says it instead.
const isLookingElsewhere = async ($: EngineInterface) => {
  const [host, front] = await Promise.all([hostApp($), frontApp($)])

  return host === undefined || front === undefined || front !== host
}

const banner = async ($: EngineInterface) => {
  try {
    await $.process.run(
      ['/usr/bin/osascript', '-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', TOAST, 'Break reminder'],
      { timeoutMs: 10_000 },
    )
  } catch {
    // No banner: the toast and the pill still show.
  }
}

// Bubbles drifting up, with a few sparkles: confetti's calmer cousin. Full window where the desktop app draws a
// backdrop behind the chat; otherwise in a strip just above the message box.
type Scene = { width: number; height: number; bubbles: number; sparkles: number; size: number }
const WINDOW: Scene = { width: 2400, height: 1500, bubbles: 40, sparkles: 18, size: 38 }
const STRIP: Scene = { width: 1000, height: 110, bubbles: 26, sparkles: 10, size: 16 }
const COLORS = ['#F7C59F', '#F4A7B9', '#9ED9CC', '#A9C8F0', '#C9B6E8', '#FFE08A']

const randomFrom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}

const bubble = (random: () => number, scene: Scene) => {
  const r = Math.round(scene.size * 0.3 + random() * scene.size)
  const x = Math.round(random() * scene.width)
  const sway = Math.round(scene.size * 0.5 + random() * scene.size * 1.5) * (random() < 0.5 ? -1 : 1)
  const H = scene.height
  const timing = `dur="${(3.8 + random() * 2).toFixed(2)}s" begin="${(random() * 1.6).toFixed(2)}s" fill="freeze"`
  const color = COLORS[Math.floor(random() * COLORS.length)]

  return [
    `<g opacity="0">`,
    `<animate attributeName="opacity" values="0;0.75;0.75;0" keyTimes="0;0.12;0.8;1" ${timing}/>`,
    `<animateTransform attributeName="transform" type="translate" values="0 0;${sway} 0;0 0;${-sway} 0;0 0" ${timing}/>`,
    `<circle cx="${x}" cy="${H + r}" r="${r}" fill="${color}" fill-opacity="0.55" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="2">`,
    `<animate attributeName="cy" values="${H + r};${-r}" ${timing}/>`,
    `</circle>`,
    `</g>`,
  ].join('')
}

const sparkle = (random: () => number, scene: Scene) => {
  const s = Math.round(scene.size * 0.2 + random() * scene.size * 0.4)
  const q = (s * 0.28).toFixed(1)
  const x = Math.round(random() * scene.width)
  const y = Math.round(random() * scene.height * 0.85)
  const timing = `dur="${(1.2 + random() * 0.8).toFixed(2)}s" begin="${(0.3 + random() * 3.5).toFixed(2)}s" fill="freeze"`
  const color = COLORS[Math.floor(random() * COLORS.length)]

  return [
    `<g transform="translate(${x} ${y})">`,
    `<path d="M0 ${-s}L${q} ${-q}L${s} 0L${q} ${q}L0 ${s}L${-q} ${q}L${-s} 0L${-q} ${-q}Z" fill="${color}" opacity="0">`,
    `<animate attributeName="opacity" values="0;1;0" ${timing}/>`,
    `<animateTransform attributeName="transform" type="scale" values="0.3;1.15;0.3" ${timing}/>`,
    `</path>`,
    `</g>`,
  ].join('')
}

// A different seed draws a different scatter, so each reminder's strip is new and its animation starts again.
export const bubblesSvg = (scene: Scene, seed: number) => {
  const random = randomFrom(seed)
  const shapes = [
    ...Array.from({ length: scene.bubbles }, () => bubble(random, scene)),
    ...Array.from({ length: scene.sparkles }, () => sparkle(random, scene)),
  ]
  const { width, height } = scene

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${shapes.join('')}</svg>`
}

const BUBBLES = bubblesSvg(WINDOW, 7)

let clearEffect: { cancel: () => void } | undefined

// Resolves what happened, in a few words, for `/break test` to report.
const showEffect = async ($: EngineInterface): Promise<string> => {
  clearEffect?.cancel()
  // The chat's panels frost over the bubbles, so they show through without hiding the text.
  const shown = await $.ui.backdrop({ id: 'break-bubbles', glass: { blur: 6, opacity: 0.5 } })

  if (shown.isDrawn) {
    clearEffect = $.clock.after(EFFECT_MS, () => void $.ui.backdrop(undefined).catch(() => {}))

    return 'bubbles drawn'
  }

  // This app doesn't draw behind the chat yet. The request would stand for a later window, so take it back, and
  // float the bubbles up the strip above the message box instead.
  await $.ui.backdrop(undefined).catch(() => {})
  const until = (await $.clock.now()) + EFFECT_MS
  await update($, stripUntil, () => until)
  clearEffect = $.clock.after(EFFECT_MS, () => void update($, stripUntil, () => 0).catch(() => {}))

  return 'bubbles above the message box'
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// What every open chat shows: the toast, and the bubbles.
const showReminder = async ($: EngineInterface, settings: Settings): Promise<string> => {
  $.ui.toast(TOAST, { timeoutMs: 15_000 })

  if (!settings.isEffectOn) {
    return 'bubbles off'
  }

  return showEffect($).catch(error => `bubbles refused (${reasonOf(error)})`)
}

// What only one chat does, so it's heard once: the sound, and a Mac banner when you're in another app.
const alert = async ($: EngineInterface, settings: Settings): Promise<string> => {
  const work: Promise<unknown>[] = []
  let sound = 'sound off'

  if (settings.isSoundOn) {
    sound = settings.isQuietDuringVoice && (await isVoiceChatOn($)) ? 'sound skipped (voice chat on)' : `sound: ${settings.sound}`

    if (!sound.startsWith('sound skipped')) {
      work.push(play($, settings.sound))
    }
  }

  const isElsewhere = await isLookingElsewhere($)

  if (isElsewhere) {
    work.push(banner($))
  }

  await Promise.allSettled(work)

  return isElsewhere ? `${sound}, Mac banner` : sound
}

// The latest reminder this chat has shown, so another chat's is shown here once.
let lastShown = 0
let isTicking = false

// Due: this chat claims the reminder by restarting the shared clock under its own id. Every chat that sees the
// claim shows the toast; only the one whose claim still stands a moment later plays the sound.
const claim = async ($: EngineInterface, due: BreakClock, settings: Settings, now: number) => {
  const id = await $.session.id()
  const claimed = await changeClock($, now, latest =>
    latest.workStart === due.workStart ? { ...latest, workStart: now, remindedAt: now, remindedBy: id } : undefined,
  )

  // Another chat got there first; its reminder shows below.
  if (claimed.remindedBy !== id || claimed.remindedAt !== now) {
    return claimed
  }

  lastShown = now
  await showReminder($, settings)
  await $.clock.sleep(CLAIM_SETTLE_MS)
  const settled = await loadClock($, now)

  if (settled.remindedBy === id && settled.remindedAt === now) {
    await alert($, settings)
  }

  lastShown = Math.max(lastShown, settled.remindedAt)

  return settled
}

const tick = async ($: EngineInterface) => {
  if (isTicking) {
    return
  }

  isTicking = true

  try {
    const settings = await loadSettings($)

    if (!settings.isOn) {
      await setPill($, null)

      return
    }

    const now = await $.clock.now()
    let clock = await loadClock($, now)
    const { isAway, remaining } = stretch(clock, settings, now)

    if (remaining <= 0 && !isAway) {
      clock = await claim($, clock, settings, now)
    }

    // Another chat's reminder: shown here too while it's fresh.
    if (clock.remindedAt > lastShown) {
      lastShown = clock.remindedAt

      if (now - clock.remindedAt < BREAK_TIME_MS) {
        await showReminder($, settings)
      }
    }

    await setPill($, pillFor(clock, settings, await $.clock.now()))
  } finally {
    isTicking = false
  }
}

// You sent a message, or the reply to it finished. Back from time away, a fresh stretch starts.
const markActive = async ($: EngineInterface) => {
  const [settings, now] = await Promise.all([loadSettings($), $.clock.now()])
  await changeClock($, now, latest =>
    now - latest.lastActive >= settings.awayMinutes * MINUTE ? { ...latest, workStart: now, lastActive: now } : { ...latest, lastActive: now },
  )
  await tick($)
}

const resetClock = async ($: EngineInterface) => {
  const now = await $.clock.now()
  await changeClock($, now, latest => ({ ...latest, workStart: now, lastActive: now }))
}

const restartClock = async ($: EngineInterface) => {
  await resetClock($)
  await tick($)
}

// Your own messages count as work: typed, from your phone, or spoken through live-voice. Scheduled tasks, other
// sessions and background notifications don't.
const isYours = (origin: PromptOrigin) =>
  origin.kind === 'composer' || origin.kind === 'bridge' || origin.kind === 'sdk' || (origin.kind === 'plugin' && origin.name === 'live-voice')

let isYourTurn = false

const HELP = [
  '`/break every 30`: a break every 30 minutes (15, 30 and 45 all work)',
  '`/break test`: see and hear the reminder now (the clock carries on)',
  '`/break restart`: start the clock over (or click the ☕ pill)',
  '`/break sound milestone`: change the sound · `/break sound off` · `/break bubbles off`',
  '`/break off` · `/break on`',
  `Sounds: ${Object.keys(SOUNDS).join(', ')}`,
].join('\n')

const describe = (settings: Settings, clock: BreakClock, now: number) => {
  const { isAway, remaining } = stretch(clock, settings, now)
  const state = remaining <= 0 && !isAway ? 'A break is due now.' : `Next break in ${countdown(remaining)}.`

  return [
    `${state} Every ${settings.everyMinutes} minutes, one clock for all your chats; ${settings.awayMinutes} minutes with no message starts it over.`,
    `Sound: ${settings.isSoundOn ? settings.sound : 'off'} · bubbles: ${settings.isEffectOn ? 'on' : 'off'}`,
    '',
    HELP,
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'break',
      description: 'Break reminder: time to your next break, how often, the sound, a test',
      argumentHint: '[every <minutes>|test|restart|sound <name>|off|on]',
      immediate: true,
    })
    // A reminder from before this chat opened (or before a reload) isn't shown again.
    lastShown = (await loadClock($, await $.clock.now())).remindedAt
    isTicking = false
    // A reload mid-reminder drops the timer that would have ended the strip.
    await update($, stripUntil, () => 0)
    await tick($)
    $.clock.every(TICK_MS, () => void tick($).catch(() => {}))

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    isYourTurn = isYours(e.origin)

    if (isYourTurn) {
      void markActive($).catch(() => {})
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined && isYourTurn) {
      void markActive($).catch(() => {})
    }

    return done
  })

  on('command.run', { command: 'break' }, async ($, e) => {
    const [word = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const [settings, now] = await Promise.all([loadSettings($), $.clock.now()])
    const save = async (changed: Settings) => {
      await $.store.set('settings', changed)
      await tick($)
    }

    if (word === '') {
      return { text: settings.isOn ? describe(settings, await loadClock($, now), now) : `Break reminders are off. \`/break on\` turns them back on.\n\n${HELP}` }
    }

    if (word === 'every') {
      const minutes = Number(value)

      if (value === '' || !Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
        return { text: 'Give a number of minutes: `/break every 30`' }
      }

      await save({ ...settings, everyMinutes: Math.round(minutes) })

      return { text: `Breaks every ${Math.round(minutes)} minutes.` }
    }

    if (word === 'test') {
      const bubbles = await showReminder($, settings)
      const sound = await alert($, settings)

      return { text: `That's the reminder: toast, ${sound}, ${bubbles}. Your clock carries on.` }
    }

    if (['restart', 'done', 'reset'].includes(word)) {
      await restartClock($)

      return { text: `Clock restarted. Next break in ${settings.everyMinutes} minutes.` }
    }

    if (word === 'sound') {
      if (value === 'on' || value === 'off') {
        await save({ ...settings, isSoundOn: value === 'on' })

        return { text: `Reminder sound ${value}.` }
      }

      if (!(value in SOUNDS)) {
        return { text: `Pick one of: ${Object.keys(SOUNDS).join(', ')}` }
      }

      await save({ ...settings, sound: value, isSoundOn: true })
      await play($, value)

      return { text: `Reminder sound set to "${value}".` }
    }

    if ((word === 'bubbles' || word === 'effect') && (value === 'on' || value === 'off')) {
      await save({ ...settings, isEffectOn: value === 'on' })

      return { text: `Bubbles ${value}.` }
    }

    if (word === 'on' || word === 'off') {
      // Back on: a fresh stretch, so the time spent with reminders off doesn't trigger one at once.
      if (word === 'on') {
        await resetClock($)
      }

      await save({ ...settings, isOn: word === 'on' })

      return { text: word === 'on' ? `Break reminders on. Next break in ${settings.everyMinutes} minutes.` : 'Break reminders off. `/break on` turns them back on.' }
    }

    return { text: HELP }
  })

  // The ☕ pill in the prompt's bottom bar, after what else draws there (live-voice's Talk button, the usage pill).
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const beside = await next(e)
    const shown = await read($, pill)

    if (shown === null) {
      return beside
    }

    const { Box, Button } = $.ui.resolve(e)
    const onPress = () =>
      void (async () => {
        await restartClock($)
        const settings = await loadSettings($)
        $.ui.toast(`☕ Clock restarted. Next break in ${settings.everyMinutes} minutes.`)
      })().catch(() => {})

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        {beside}
        <Button key="break-pill" label={shown.label} variant={shown.isBreakTime ? 'primary' : undefined} onPress={onPress} />
      </Box>
    )
  })

  // The bubbles in a strip just above the message box, under whatever else draws there (live-voice's card, the
  // usage card), for the few seconds a reminder lasts.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const above = await next(e)
    const until = await read($, stripUntil)

    if (until === 0 || e.props.hasSurvey || e.surface === 'terminal') {
      return above
    }

    const { Box, Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {above}
        <Svg source={bubblesSvg(STRIP, until % 100_000)} alt="Bubbles drifting up: time for a break" isInteractive />
      </Box>
    )
  })

  // The bubbles, behind the whole window, for the few seconds the backdrop stands.
  on('ui.render', { component: 'Backdrop' }, async ($, e, next) => {
    // Only the desktop app draws a backdrop; the terminal has no Svg.
    if (e.props.plugin !== 'break-reminder' || e.surface === 'terminal') {
      return next(e)
    }

    const { Svg } = $.ui.resolve(e)

    return <Svg source={BUBBLES} alt="Bubbles drifting up the window: time for a break" isInteractive />
  })
}
