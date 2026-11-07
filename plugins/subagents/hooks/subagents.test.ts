import { expect, mock, test } from 'claude-code/testing'

const pane = (surface: 'desktop' | 'terminal') =>
  ({
    plugin: 'subagents',
    surface,
    component: 'Pane',
    requestId: 'subagents',
    props: { title: 'Subagents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  }) as any

// Engine stand-ins: an open pane list, the agents the engine lists, and a chat cost.
const setup = async ($: any, on: any, options: { agents?: { id: string; description: string; type: string; status: string }[] } = {}) => {
  const open: string[] = []
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }) as any)
  on('ui.open', (_: unknown, e: { id: string }) => {
    if (!open.includes(e.id)) open.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    open.splice(open.indexOf(e.id), 1)
    return { value: undefined } as any
  })
  on('ui.panes', () => ({ value: open.map(id => ({ id, title: 'Subagents', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.toast', (_: unknown, e: { text: string }) => {
    toasts.push(e.text)
    return { value: undefined } as any
  })
  on('agent.list', () => ({ value: options.agents ?? [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 2, percent: 1 }, rateLimits: [], cost: { usd: 3.456 } } }))
  on('agent.spawn', (_: unknown, e: { description: string }) => ({ model: 'claude-sonnet-5-5', agentId: e.description === 'Check the tests' ? 'a2' : 'a1' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_: unknown, e: { reason: string }) => ({ text: '', reason: e.reason }) as any)
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  return { open, toasts, clock }
}

const spawn = ($: any, description: string, subagentType = 'Explore') => $.agent.spawn({ prompt: 'Go', description, subagentType } as any)
const finish = ($: any, agentId: string, reason: string) =>
  $.turn.complete({ answer: '', durationMs: 5_000, isAborted: reason === 'aborted', turnId: `t-${agentId}`, agentId, reason } as any)

test('the first subagent opens the pane once, with a card for it', async ($, on) => {
  const { open } = await setup($, on)
  await spawn($, 'Read the docs')
  expect(open).toEqual(['subagents'])

  const ui = await $.ui.mount(pane('desktop'))
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Read the docs')
  expect(drawn).toContain('Explore · Sonnet 5.5')
  expect(drawn).toContain('Working · 0s')
  expect(drawn).toContain('1 working')
  expect(drawn).toContain('API ≈ $3.46')

  // Closed by hand, it stays closed for the next subagent.
  await $.command.run({ command: 'subagents', args: '' } as any)
  await spawn($, 'Check the tests')
  expect(open).toEqual([])
})

test('a subagent tool call shows as the step it is on', async ($, on) => {
  await setup($, on)
  await spawn($, 'Read the docs')
  await $.tool.call({ tool: 'Read', file_path: '/repo/docs/README.md', agentId: 'a1' } as any)

  const ui = await $.ui.mount(pane('desktop'))
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Reading README.md')
  expect(drawn).toContain('1 tool call ·')
})

test('main-thread tool calls make no card', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'Read', file_path: '/repo/README.md' } as any)

  const ui = await $.ui.mount(pane('desktop'))
  expect(JSON.stringify(await ui.drawn())).toContain('No subagents yet')
})

test('a finished subagent turns green, a failed one red, a stopped one gray', async ($, on) => {
  const { clock } = await setup($, on)
  await spawn($, 'Read the docs')
  await spawn($, 'Check the tests')
  await clock.advance(65_000)
  await finish($, 'a1', 'answer')
  await finish($, 'a2', 'error')

  const ui = await $.ui.mount(pane('desktop'))
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Done in 1m 05s')
  expect(drawn).toContain('Finished its task')
  expect(drawn).toContain('Failed after 1m 05s')
  expect(drawn).toContain('#34C759')
  expect(drawn).toContain('#FF453A')
  expect(drawn).toContain('2 finished')
})

test('a tool call from an agent the engine lists, before its spawn is seen, still gets a card', async ($, on) => {
  await setup($, on, { agents: [{ id: 'b7', description: 'Plan the move', type: 'Plan', status: 'running' }] })
  await $.tool.call({ tool: 'Grep', pattern: 'TODO', agentId: 'b7' } as any)

  const ui = await $.ui.mount(pane('desktop'))
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Plan the move')
  expect(drawn).toContain('Searching for \\"TODO\\"')
})

test('the terminal draws the bars in block characters', async ($, on) => {
  await setup($, on)
  await spawn($, 'Read the docs')
  await finish($, 'a1', 'answer')

  const ui = await $.ui.mount(pane('terminal'))
  expect(JSON.stringify(await ui.drawn())).toContain('████████████████████')
})

test('Clear finished and /subagents clear keep only the working cards', async ($, on) => {
  await setup($, on)
  await spawn($, 'Read the docs')
  await spawn($, 'Check the tests')
  await finish($, 'a1', 'answer')

  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'clear' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('Read the docs')
  expect(drawn).toContain('Check the tests')

  await finish($, 'a2', 'answer')
  await $.command.run({ command: 'subagents', args: 'clear' } as any)
  expect(JSON.stringify(await ui.drawn())).toContain('No subagents yet')
})

test('/subagents opens and closes the pane', async ($, on) => {
  const { open } = await setup($, on)
  await $.command.run({ command: 'subagents', args: '' } as any)
  expect(open).toEqual(['subagents'])
  await $.command.run({ command: 'subagents', args: '' } as any)
  expect(open).toEqual([])
})
