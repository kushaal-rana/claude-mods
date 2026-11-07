import { expect, mock, test } from 'claude-code/testing'

const pane = (surface: 'desktop' | 'terminal') =>
  ({
    plugin: 'mod-manager',
    surface,
    component: 'Pane',
    requestId: 'mods',
    props: { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as any

const HOOKS = JSON.stringify({ modules: ['./register.tsx'] })

// A Claude Code folder with three mods and one plugin that isn't a mod.
const baseFiles = (): Record<string, string> => ({
  '/home/k/.claude/plugins/installed_plugins.json': JSON.stringify({
    version: 2,
    plugins: {
      'zebra-tool@other-mods': [{ scope: 'user', installPath: '/cache/zebra', version: '2.0.0' }],
      'chime@kushaal-mods': [{ scope: 'user', installPath: '/cache/chime', version: '1.0.0' }],
      'telegram@claude-plugins-official': [{ scope: 'user', installPath: '/cache/telegram', version: '0.0.7' }],
      'mod-manager@kushaal-mods': [{ scope: 'user', installPath: '/cache/mod-manager', version: '1.0.0' }],
    },
  }),
  '/cache/chime/hooks/hooks.json': HOOKS,
  '/cache/chime/.claude-plugin/plugin.json': JSON.stringify({ name: 'chime', version: '1.0.0', description: 'A sound' }),
  '/cache/telegram/.claude-plugin/plugin.json': JSON.stringify({ name: 'telegram', version: '0.0.7', description: 'A Telegram bot' }),
  '/cache/mod-manager/hooks/hooks.json': HOOKS,
  '/cache/mod-manager/.claude-plugin/plugin.json': JSON.stringify({ name: 'mod-manager', version: '1.0.0' }),
  '/cache/zebra/hooks/hooks.json': HOOKS,
  '/cache/zebra/.claude-plugin/plugin.json': JSON.stringify({ name: 'zebra-tool', version: '2.0.0', description: 'Zebra stripes on the transcript' }),
  '/cache/zebra/hooks/register.tsx': "await $.command.register({ name: 'zebra', description: 'Stripes' })",
})

const setup = async ($: any, on: any, options: { files?: Record<string, string>; failWith?: string } = {}) => {
  const files = options.files ?? baseFiles()
  const enabled: Record<string, boolean> = { 'chime@kushaal-mods': true, 'mod-manager@kushaal-mods': true, 'zebra-tool@other-mods': false, 'telegram@claude-plugins-official': true }
  const runs: string[] = []
  const open: string[] = []
  mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: undefined }) as any)
  on('env.get', (_: unknown, e: { name: string }) => ({ value: ({ HOME: '/home/k', CLAUDE_CODE_EXECPATH: '/app/claude' } as Record<string, string>)[e.name] }))
  on('fs.read', (_: unknown, e: { path: string }) => (e.path in files ? { value: files[e.path] } : { deny: 'no such file' }) as any)
  on('settings.read', () => ({ value: { enabledPlugins: { ...enabled } } }) as any)
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    runs.push(e.argv.join(' '))
    const [, , verb, id] = e.argv

    if (options.failWith !== undefined) {
      return { value: { exitCode: 1, stdout: '', stderr: options.failWith, isStdoutTruncated: false, isStderrTruncated: false } }
    }

    if (id !== undefined) {
      enabled[id] = verb === 'enable'
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', (_: unknown, e: { id: string }) => {
    if (!open.includes(e.id)) open.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    open.splice(open.indexOf(e.id), 1)
    return { value: undefined } as any
  })
  on('ui.panes', () => ({ value: open.map(id => ({ id, title: 'Mods', isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  return { runs, open, enabled }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`/mods lists every installed mod, and no other plugin, on the ${surface}`, async ($, on) => {
    const { open } = await setup($, on)
    await $.command.run({ command: 'mods', args: '' } as any)
    expect(open).toEqual(['mods'])

    const ui = await $.ui.mount(pane(surface))
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('🔔 Chime')
    expect(drawn).toContain('How to use: /chime shows its settings')
    expect(drawn).toContain('🧩 Zebra Tool')
    expect(drawn).toContain('Zebra stripes on the transcript')
    expect(drawn).toContain('How to use: /zebra')
    expect(drawn).toContain('2 on · 1 off')
    expect(drawn).not.toContain('Telegram')
    // Kushaal's own mods come first.
    expect(drawn.indexOf('Chime')).toBeLessThan(drawn.indexOf('Mod Manager'))
    expect(drawn.indexOf('Mod Manager')).toBeLessThan(drawn.indexOf('Zebra Tool'))
  })
}

test("a switch runs Claude Code's own plugin command and shows the new state", async ($, on) => {
  const { runs, enabled } = await setup($, on)
  await $.command.run({ command: 'mods', args: '' } as any)
  const ui = await $.ui.mount(pane('desktop'))

  await ui.press({ key: 'toggle-chime' })
  expect(runs).toEqual(['/app/claude plugin disable chime@kushaal-mods --scope user'])
  expect(enabled['chime@kushaal-mods']).toBe(false)
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Chime is off. New chats start without it')
  expect(drawn).toContain('1 on · 2 off')

  await ui.press({ key: 'toggle-zebra-tool' })
  expect(runs[1]).toBe('/app/claude plugin enable zebra-tool@other-mods --scope user')
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Zebra Tool is on.')
})

test('a switch that fails says why, and the mod stays as it was', async ($, on) => {
  await setup($, on, { failWith: 'Plugin not found\nmore' })
  await $.command.run({ command: 'mods', args: '' } as any)
  const ui = await $.ui.mount(pane('desktop'))

  await ui.press({ key: 'toggle-chime' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain("Couldn't turn Chime off: Plugin not found")
  expect(drawn).toContain('2 on · 1 off')
})

test('the mod manager is always on and has no switch', async ($, on) => {
  await setup($, on)
  await $.command.run({ command: 'mods', args: '' } as any)
  const ui = await $.ui.mount(pane('desktop'))

  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Always on')
  expect(drawn).not.toContain('toggle-mod-manager')
})

test('with no mods installed the pane says so', async ($, on) => {
  await setup($, on, { files: { '/home/k/.claude/plugins/installed_plugins.json': JSON.stringify({ version: 2, plugins: {} }) } })
  await $.command.run({ command: 'mods', args: '' } as any)
  const ui = await $.ui.mount(pane('desktop'))

  expect(JSON.stringify(await ui.drawn())).toContain('No mods installed yet')
})

test('/mods closes the pane when it is open', async ($, on) => {
  const { open } = await setup($, on)
  await $.command.run({ command: 'mods', args: '' } as any)
  await $.command.run({ command: 'mods', args: '' } as any)
  expect(open).toEqual([])
})
