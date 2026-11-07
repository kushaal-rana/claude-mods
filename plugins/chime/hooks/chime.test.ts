import { expect, mock, test } from 'claude-code/testing'

const setup = async ($: any, on: any, options: { isVoiceOn?: boolean; chat?: { id: string } } = {}) => {
  const chat = options.chat ?? { id: 'chat-a' }
  on('session.id', () => ({ value: chat.id }) as any)
  on('tool.call', () => ({ result: { answers: {} } }) as any)
  const ran: string[][] = []
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as any)
  on('turn.complete', () => ({ text: '' }))
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    ran.push(e.argv)
    // pgrep answers 0 when the live-voice helper is running, 1 when it isn't.
    const exitCode = e.argv[0] === '/usr/bin/pgrep' ? (options.isVoiceOn ? 0 : 1) : 0
    return { value: { exitCode, stdout: '', stderr: '' } } as any
  })
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  return { ran, clock }
}

const turn = (durationMs: number, extra: Record<string, unknown> = {}) =>
  ({ answer: 'All tests pass.', durationMs, isAborted: false, turnId: 't1', reason: 'answer', ...extra }) as any
const played = (ran: string[][]) => ran.filter(argv => argv[0] === '/usr/bin/afplay').map(argv => argv[1])

test('chimes with Glass after a reply that took 15 seconds or more', async ($, on) => {
  const { ran, clock } = await setup($, on)
  await $.turn.complete(turn(20_000))
  await clock.settle()

  expect(played(ran)).toEqual([expect.stringContaining('Glass.aiff')])
})

test('stays quiet after a quick reply', async ($, on) => {
  const { ran, clock } = await setup($, on)
  await $.turn.complete(turn(4_000))
  await clock.settle()

  expect(played(ran)).toHaveLength(0)
})

test('stays quiet after an interrupted reply or a subagent', async ($, on) => {
  const { ran, clock } = await setup($, on)
  await $.turn.complete(turn(60_000, { isAborted: true, reason: 'aborted' }))
  await $.turn.complete(turn(60_000, { agentId: 'sub-1' }))
  await clock.settle()

  expect(played(ran)).toHaveLength(0)
})

test('stays quiet while a live-voice chat is running, unless asked not to', async ($, on) => {
  const { ran, clock } = await setup($, on, { isVoiceOn: true })
  await $.turn.complete(turn(60_000))
  await clock.settle()
  expect(played(ran)).toHaveLength(0)

  await $.command.run({ command: 'chime', args: 'voice on' } as any)
  await $.turn.complete(turn(60_000))
  await clock.settle()
  expect(played(ran)).toHaveLength(1)
})

test('/chime after, /chime sound and /chime off change what plays', async ($, on) => {
  const { ran, clock } = await setup($, on)
  await $.command.run({ command: 'chime', args: 'after 0' } as any)
  await $.turn.complete(turn(2_000))
  await clock.settle()
  expect(played(ran)).toHaveLength(1)

  await $.command.run({ command: 'chime', args: 'sound hero' } as any)
  // Picking a sound plays it once as a preview.
  expect(played(ran).at(-1)).toContain('Hero.aiff')
  await $.turn.complete(turn(2_000))
  await clock.settle()
  expect(played(ran).at(-1)).toContain('Hero.aiff')

  await $.command.run({ command: 'chime', args: 'off' } as any)
  const before = played(ran).length
  await $.turn.complete(turn(60_000))
  await clock.settle()
  expect(played(ran)).toHaveLength(before)
})

test('plays the question tone when Claude asks something or wants a plan approved', async ($, on) => {
  const { ran, clock } = await setup($, on)
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [{ question: 'Which color?', header: 'Color', options: [], multiSelect: false }] } as any)
  await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'p1', plan: 'Do the thing' } as any)
  await clock.settle()

  expect(played(ran)).toEqual([expect.stringContaining('QuestionMark.caf'), expect.stringContaining('QuestionMark.caf')])

  await $.command.run({ command: 'chime', args: 'ask off' } as any)
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q2', questions: [{ question: 'Again?', header: 'Again', options: [], multiSelect: false }] } as any)
  await clock.settle()
  expect(played(ran)).toHaveLength(2)
})

test('/chime with no arguments shows the settings', async ($, on) => {
  await setup($, on)
  const shown = await $.command.run({ command: 'chime', args: '' } as any)

  expect(JSON.stringify(shown)).toContain('replies that take 15s or more')
})

test('a chat can have a reply sound of its own; other chats keep the default', async ($, on) => {
  const chat = { id: 'chat-a' }
  const { ran, clock } = await setup($, on, { chat })
  await $.command.run({ command: 'chime', args: 'sound tink here' } as any)
  // Picking it plays it once.
  expect(played(ran).at(-1)).toContain('Tink.aiff')

  await $.turn.complete(turn(20_000))
  await clock.settle()
  expect(played(ran).at(-1)).toContain('Tink.aiff')

  const shown = await $.command.run({ command: 'chime', args: '' } as any)
  expect(JSON.stringify(shown)).toContain('this chat: tink')

  // Another chat still gets the default.
  chat.id = 'chat-b'
  await $.turn.complete(turn(20_000))
  await clock.settle()
  expect(played(ran).at(-1)).toContain('Glass.aiff')

  // Changing the default leaves chat A's own sound alone.
  await $.command.run({ command: 'chime', args: 'sound hero' } as any)
  chat.id = 'chat-a'
  await $.turn.complete(turn(20_000))
  await clock.settle()
  expect(played(ran).at(-1)).toContain('Tink.aiff')

  // And `default here` hands it back.
  await $.command.run({ command: 'chime', args: 'sound default here' } as any)
  await $.turn.complete(turn(20_000))
  await clock.settle()
  expect(played(ran).at(-1)).toContain('Hero.aiff')
})

test('an unknown sound for this chat is refused', async ($, on) => {
  const { ran } = await setup($, on)
  const answer = await $.command.run({ command: 'chime', args: 'sound kazoo here' } as any)

  expect(JSON.stringify(answer)).toContain('Pick one of')
  expect(played(ran)).toHaveLength(0)
})
