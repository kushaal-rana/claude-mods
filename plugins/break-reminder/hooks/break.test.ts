import { expect, mock, test } from 'claude-code/testing'

const MINUTE = 60_000
const T0 = Date.UTC(2026, 10, 6, 18, 0, 0)
const bar = { modes: [] } as any

type Options = {
  store?: Record<string, unknown>
  isVoiceOn?: boolean
  frontApp?: string
  chat?: { id: string }
  // false: like today's desktop app, which draws no backdrop behind the chat.
  canDrawBackdrop?: boolean
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120 } as any

// A store the test can reach into, so it can play the part of another open chat.
const setup = async ($: any, on: any, options: Options = {}) => {
  const store: Record<string, unknown> = { ...(options.store ?? {}) }
  const chat = options.chat ?? { id: 'chat-a' }
  const ran: string[][] = []
  const toasts: string[] = []
  const backdrops: unknown[] = []
  const clock = mock.clock(on, { now: T0 })
  mock.env(on, {})
  on('store.get', (_$: unknown, e: { key: string }) => ({ value: store[e.key] }) as any)
  on('store.set', (_$: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined } as any
  })
  on('session.id', () => ({ value: chat.id }) as any)
  on('session.surface', () => ({ value: 'desktop' }) as any)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as any)
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }) as any)
  on('turn.complete', () => ({ text: '' }) as any)
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined } as any
  })
  on('ui.backdrop', (_$: unknown, e: { backdrop: unknown }) => {
    backdrops.push(e.backdrop ?? null)
    const isDrawn = e.backdrop !== undefined && options.canDrawBackdrop !== false
    return { value: isDrawn ? { isDrawn: true, requestId: 'backdrop' } : { isDrawn: false, reason: 'no attached desktop client says it draws backdrops' } } as any
  })
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as const)
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    ran.push(e.argv)
    const front = options.frontApp ?? 'Claude'
    // pgrep answers 0 when the live-voice helper is running; lsappinfo names the app in front.
    const exitCode = e.argv[0] === '/usr/bin/pgrep' ? (options.isVoiceOn ? 0 : 1) : 0
    const stdout = e.argv[0] === '/bin/sh' ? `"LSDisplayName"="${front}"` : ''
    return { value: { exitCode, stdout, stderr: '' } } as any
  })
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  const say = async (text = 'next step') => {
    await $.prompt.submit({ text, origin: { kind: 'composer' } } as any)
    await clock.settle()
  }

  const pill = async () => {
    const ui = await $.ui.mount({ plugin: 'break-reminder', surface: 'desktop', component: 'SessionMode', props: bar })
    const drawn = JSON.stringify(await ui.drawn())
    await ui.unmount()
    return drawn
  }

  return { store, chat, ran, toasts, backdrops, clock, say, pill }
}

const played = (ran: string[][]) => ran.filter(argv => argv[0] === '/usr/bin/afplay').map(argv => argv[1])
const banners = (ran: string[][]) => ran.filter(argv => argv[0] === '/usr/bin/osascript')

// Keep chatting so the stretch never counts as time away, up to `minutes` past the start.
const workUntil = async (world: Awaited<ReturnType<typeof setup>>, minutes: number) => {
  while (world.clock.now() < T0 + minutes * MINUTE) {
    await world.clock.advance(Math.min(5 * MINUTE, T0 + minutes * MINUTE - world.clock.now()))
    await world.say()
  }
}

test('the pill counts down to the next break, beside what else is in the bottom bar', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  expect(await world.pill()).toContain('"label":"☕ 15m"')

  await world.clock.advance(4 * MINUTE + 30_000)
  const drawn = await world.pill()
  expect(drawn).toContain('"label":"☕ 11m"')
  // live-voice's Talk button and the usage pill stay beside it.
  expect(drawn).toContain('"type":"engine"')
})

test('after 15 minutes of work: the toast, the sound, the bubbles, then the clock starts over', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await workUntil(world, 14)
  expect(world.toasts).toHaveLength(0)

  await world.clock.advance(MINUTE + 10_000)
  expect(world.toasts).toEqual(['☕ Take a break'])
  expect(played(world.ran)).toEqual([expect.stringContaining('Aurora.m4r')])
  expect(world.backdrops[0]).toEqual(expect.objectContaining({ id: 'break-bubbles' }))
  expect(await world.pill()).toContain('"label":"☕ Break time"')
  // In the app already, so no Mac banner.
  expect(banners(world.ran)).toHaveLength(0)

  // The bubbles clear after a few seconds.
  await world.clock.advance(10_000)
  expect(world.backdrops.at(-1)).toBe(null)

  // A minute on, the pill counts down to the next one, once.
  await world.clock.advance(MINUTE)
  expect(await world.pill()).toContain('"label":"☕ 14m"')
  expect(world.toasts).toHaveLength(1)
})

test('the bubbles draw full window behind the chat, and leave other mods backdrops alone', async ($, on) => {
  await setup($, on)
  const mine = await $.ui.mount({
    plugin: 'break-reminder',
    surface: 'desktop',
    component: 'Backdrop',
    requestId: 'backdrop',
    props: { id: 'break-bubbles', plugin: 'break-reminder', glass: { blur: 6, opacity: 0.5 } },
  } as any)
  const drawn = JSON.stringify(await mine.drawn())
  expect(drawn).toContain('<animate')
  expect(drawn).toContain('"isInteractive":true')
  await mine.unmount()

  const theirs = await $.ui.mount({
    plugin: 'break-reminder',
    surface: 'desktop',
    component: 'Backdrop',
    requestId: 'backdrop',
    props: { id: 'lagoon', plugin: 'someone-else', glass: false },
  } as any)
  expect(JSON.stringify(await theirs.drawn())).toContain('"type":"engine"')
  await theirs.unmount()
})

test('where the app draws no backdrop, the bubbles float up a strip above the message box for a few seconds', async ($, on) => {
  const world = await setup($, on, { canDrawBackdrop: false })
  const band = await $.ui.mount({ plugin: 'break-reminder', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(JSON.stringify(await band.drawn())).not.toContain('<animate')

  const answer = await $.command.run({ command: 'break', args: 'test' } as any)
  expect(JSON.stringify(answer)).toContain('bubbles above the message box')
  const drawn = JSON.stringify(await band.drawn())
  expect(drawn).toContain('<animate')
  expect(drawn).toContain('"isInteractive":true')
  // What other mods draw there (live-voice's card, the usage card) stays.
  expect(drawn).toContain('"type":"engine"')
  // The backdrop request it couldn't draw is taken back.
  expect(world.backdrops.at(-1)).toBe(null)

  await world.clock.advance(9_000)
  expect(JSON.stringify(await band.drawn())).not.toContain('<animate')
  await band.unmount()
})

test('a Mac banner when you are in another app', async ($, on) => {
  const world = await setup($, on, { frontApp: 'Safari' })
  await world.say('hello')
  await workUntil(world, 14)
  await world.clock.advance(MINUTE + 10_000)

  expect(banners(world.ran)).toHaveLength(1)
  expect(banners(world.ran)[0]).toContain('☕ Take a break')
})

test('ten minutes with no message counts as a break: no reminder, and a fresh 15 when you are back', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await world.clock.advance(30 * MINUTE)
  expect(world.toasts).toHaveLength(0)
  expect(played(world.ran)).toHaveLength(0)

  await world.say('back')
  expect(await world.pill()).toContain('"label":"☕ 15m"')
})

test('another chat already reminded you: the toast shows here too, but the sound plays only there', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await world.clock.advance(2 * MINUTE)

  // The other chat claims a reminder: it restarts the shared clock under its own id.
  const now = world.clock.now()
  world.store.clock = { workStart: now, lastActive: now, remindedAt: now, remindedBy: 'chat-b' }
  await world.clock.advance(6_000)

  expect(world.toasts).toEqual(['☕ Take a break'])
  expect(played(world.ran)).toHaveLength(0)
  expect(await world.pill()).toContain('"label":"☕ Break time"')
})

test('two chats claim the same reminder: only the one whose claim stands plays the sound', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await workUntil(world, 14)
  // Step to the moment the claim is written, then let the other chat overwrite it before the check.
  while ((world.store.clock as { remindedBy: string }).remindedBy !== 'chat-a') {
    await world.clock.advance(1_000)
  }
  const now = world.clock.now()
  world.store.clock = { workStart: now, lastActive: now, remindedAt: now, remindedBy: 'chat-b' }
  await world.clock.advance(5_000)

  expect(played(world.ran)).toHaveLength(0)
  // Shown once here, not twice.
  expect(world.toasts).toEqual(['☕ Take a break'])
})

test('quiet during a live-voice chat, but the toast still shows', async ($, on) => {
  const world = await setup($, on, { isVoiceOn: true })
  await world.say('hello')
  await workUntil(world, 14)
  await world.clock.advance(MINUTE + 10_000)

  expect(world.toasts).toEqual(['☕ Take a break'])
  expect(played(world.ran)).toHaveLength(0)
})

test('/break every 30 changes the interval; a bad number is refused', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await $.command.run({ command: 'break', args: 'every 30' } as any)
  expect(await world.pill()).toContain('"label":"☕ 30m"')

  const answer = await $.command.run({ command: 'break', args: 'every soon' } as any)
  expect(JSON.stringify(answer)).toContain('Give a number of minutes')
  expect(JSON.stringify(await $.command.run({ command: 'break', args: '' } as any))).toContain('Every 30 minutes')
})

test('/break test shows and plays the reminder without touching the clock', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await world.clock.advance(5 * MINUTE)
  const answer = await $.command.run({ command: 'break', args: 'test' } as any)

  // It says what each part did, so a missing one is easy to spot.
  expect(JSON.stringify(answer)).toContain('toast, sound: aurora, bubbles drawn')
  expect(world.toasts).toEqual(['☕ Take a break'])
  expect(played(world.ran)).toHaveLength(1)
  expect(await world.pill()).toContain('"label":"☕ 10m"')
})

test('/break sound picks and previews another sound; an unknown one is refused', async ($, on) => {
  const world = await setup($, on)
  await $.command.run({ command: 'break', args: 'sound milestone' } as any)
  expect(played(world.ran).at(-1)).toContain('Milestone-EncoreInfinitum.caf')

  const answer = await $.command.run({ command: 'break', args: 'sound kazoo' } as any)
  expect(JSON.stringify(answer)).toContain('Pick one of')
  expect(played(world.ran)).toHaveLength(1)
})

test('clicking the pill starts the clock over', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await world.clock.advance(9 * MINUTE)
  expect(await world.pill()).toContain('"label":"☕ 6m"')

  const ui = await $.ui.mount({ plugin: 'break-reminder', surface: 'desktop', component: 'SessionMode', props: bar })
  await ui.press({ key: 'break-pill' })
  await world.clock.settle()
  expect(JSON.stringify(await ui.drawn())).toContain('"label":"☕ 15m"')
  expect(world.toasts.at(-1)).toContain('Clock restarted')
  await ui.unmount()
})

test('/break off hides the pill and stops reminders; /break on brings them back', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  await $.command.run({ command: 'break', args: 'off' } as any)
  expect(await world.pill()).not.toContain('☕')

  await workUntil(world, 20)
  expect(world.toasts).toHaveLength(0)

  await $.command.run({ command: 'break', args: 'on' } as any)
  expect(await world.pill()).toContain('"label":"☕ 15m"')
})

test('messages from scheduled tasks or other sessions do not count as your work', async ($, on) => {
  const world = await setup($, on)
  await world.say('hello')
  for (let minute = 5; minute <= 30; minute += 5) {
    await world.clock.advance(5 * MINUTE)
    await $.prompt.submit({ text: 'nightly run', origin: { kind: 'scheduled-trigger' } } as any)
    await world.clock.settle()
  }

  expect(world.toasts).toHaveLength(0)
})
