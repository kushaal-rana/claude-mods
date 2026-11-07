import { expect, mock, test } from 'claude-code/testing'

const band = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120 } as any
const bar = { modes: [] } as any

const usage = {
  startedAt: Date.now() - 2 * 3_600_000,
  context: { tokens: 383_000, window: 1_000_000, percent: 38 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(Date.now() + 4 * 3_600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 26, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
  ],
  cost: { usd: 16.784 },
}

const setup = async ($: any, on: any, options: { isOpen?: boolean; calls?: string[]; hasLimits?: boolean } = {}) => {
  const calls = options.calls ?? []
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on, options.isOpen === undefined ? {} : { isOpen: options.isOpen })
  on('session.usage', () => ({ value: options.hasLimits === false ? { ...usage, rateLimits: [] } : usage }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as any)
  on('command.run', (_$: unknown, e: { command: string }) => {
    calls.push(`/${e.command}`)
    return { text: '' }
  })
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    calls.push('toast: ' + e.text)
    return { value: undefined } as any
  })
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as const)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  return { calls, clock }
}

test('the bottom-bar pill shows context and the 5-hour limit, short, after what else is drawn there', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'SessionMode', props: bar })
  const drawn = JSON.stringify(await ui.drawn())

  // Short enough to fit beside live-voice's "Voice on".
  expect(drawn).toContain('"label":"38% · 12%"')
  // live-voice's Talk button and the mode labels stay beside it.
  expect(drawn).toContain('"type":"engine"')
})

test('the card starts hidden, and the pill opens it', async ($, on) => {
  await setup($, on)
  const card = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'AbovePrompt', props: band })
  expect(JSON.stringify(await card.drawn())).not.toContain('5-hour limit')

  const pill = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'SessionMode', props: bar })
  await pill.press({ key: 'usage-pill' })

  const drawn = JSON.stringify(await card.drawn())
  expect(drawn).toContain('383k of 1M tokens')
  expect(drawn).toContain('5-hour limit')
  expect(drawn).toMatch(/resets in 4h \d+m/)
  expect(drawn).toContain('Weekly limit')
  expect(drawn).toContain('API ≈ $16.78')
  expect(drawn).toContain('"label":"Hide"')
  // No Compact button, by design: the card only reports.
  expect(drawn).not.toContain('Compact')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`draws the card on the ${surface} when it was left open`, async ($, on) => {
    await setup($, on, { isOpen: true })
    const ui = await $.ui.mount({ plugin: 'usage-card', surface, component: 'AbovePrompt', props: band })
    const drawn = JSON.stringify(await ui.drawn())

    expect(drawn).toContain('Context')
    expect(drawn).toMatch(/"(1h 59m|2h 0m)"/)
    // What other mods draw in the band stays, above the card.
    expect(drawn).toContain('"type":"engine"')
  })
}

test('Hide closes the card', async ($, on) => {
  await setup($, on, { isOpen: true })
  const ui = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'AbovePrompt', props: band })
  expect(JSON.stringify(await ui.drawn())).toContain('5-hour limit')

  await ui.press({ key: 'hide' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('5-hour limit')
})

test('the pill reads "Ctx" alone when the plan reports no limits', async ($, on) => {
  await setup($, on, { hasLimits: false })
  const ui = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'SessionMode', props: bar })

  expect(JSON.stringify(await ui.drawn())).toContain('"label":"Ctx 38%"')
})

test('/usage-card toggles the card', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ plugin: 'usage-card', surface: 'desktop', component: 'AbovePrompt', props: band })
  await $.command.run({ command: 'usage-card', args: '' } as any)
  expect(JSON.stringify(await ui.drawn())).toContain('Weekly limit')

  await $.command.run({ command: 'usage-card', args: 'off' } as any)
  expect(JSON.stringify(await ui.drawn())).not.toContain('Weekly limit')
})
