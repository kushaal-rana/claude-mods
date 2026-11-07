import type { EngineInterface, Register } from 'claude-code'

const SYSTEM_SOUNDS = '/System/Library/Sounds'
const TONES = '/System/Library/PrivateFrameworks/ToneLibrary.framework/Versions/A/Resources/AlertTones'

// Two of iMessage's tones, then macOS's own alert sounds. All ship with macOS, so the mod carries no audio.
const SOUNDS: Record<string, string> = {
  message: `${TONES}/ReceivedMessage.caf`,
  question: `${TONES}/Text-Message-Acknowledgement-QuestionMark.caf`,
  ...Object.fromEntries(
    ['Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero', 'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink'].map(name => [
      name.toLowerCase(),
      `${SYSTEM_SOUNDS}/${name}.aiff`,
    ]),
  ),
}

export type Settings = {
  isOn: boolean
  // Replies quicker than this stay quiet: you were probably still watching.
  afterSeconds: number
  sound: string
  askSound: string
  isAskOn: boolean
  // Quiet while a live-voice chat is running, so its microphone never hears the chime.
  isQuietDuringVoice: boolean
}

export const DEFAULTS: Settings = {
  isOn: true,
  afterSeconds: 15,
  sound: 'glass',
  askSound: 'question',
  isAskOn: true,
  isQuietDuringVoice: true,
}

const loadSettings = async ($: EngineInterface): Promise<Settings> => {
  const saved = await $.store.get('settings')

  return { ...DEFAULTS, ...(typeof saved === 'object' && saved !== null ? (saved as Partial<Settings>) : {}) }
}

const saveSettings = ($: EngineInterface, settings: Settings) => $.store.set('settings', settings)

// Chats with a reply sound of their own, by session id. Past this many, the oldest drop off.
const MAX_CHAT_SOUNDS = 200

const loadChatSounds = async ($: EngineInterface): Promise<Record<string, string>> => {
  const saved = await $.store.get('chatSounds')

  return typeof saved === 'object' && saved !== null ? (saved as Record<string, string>) : {}
}

// This chat's own reply sound, if it has one.
const chatSound = async ($: EngineInterface): Promise<string | undefined> => (await loadChatSounds($))[await $.session.id()]

const setChatSound = async ($: EngineInterface, sound: string | undefined) => {
  const id = await $.session.id()
  const next = { ...(await loadChatSounds($)) }
  delete next[id]

  if (sound !== undefined) {
    next[id] = sound
  }

  const ids = Object.keys(next)
  await $.store.set('chatSounds', Object.fromEntries(ids.slice(-MAX_CHAT_SOUNDS).map(key => [key, next[key] ?? ''])))
}

const replySound = async ($: EngineInterface, settings: Settings) => (await chatSound($)) ?? settings.sound

const play = async ($: EngineInterface, sound: string) => {
  try {
    await $.process.run(['/usr/bin/afplay', SOUNDS[sound] ?? `${SYSTEM_SOUNDS}/Glass.aiff`], { timeoutMs: 15_000 })
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

const shouldPlay = async ($: EngineInterface, settings: Settings) =>
  settings.isOn && !(settings.isQuietDuringVoice && (await isVoiceChatOn($)))

// A question or plan-approval dialog opens while the call runs, so the sound plays as it appears.
const askingSound = ($: EngineInterface, agentId: string | undefined) => {
  if (agentId !== undefined) {
    return
  }

  void (async () => {
    const settings = await loadSettings($)

    if (settings.isAskOn && (await shouldPlay($, settings))) {
      await play($, settings.askSound)
    }
  })().catch(() => {})
}

const HELP = [
  '`/chime on` · `/chime off` · `/chime test`',
  '`/chime after 30`: chime only for replies that take 30 seconds or more (`/chime after 0`: every reply)',
  '`/chime sound hero`: change the reply sound · `/chime ask-sound ping`: change the "needs you" sound',
  '`/chime sound tink here`: a reply sound for this chat only (`/chime sound default here` goes back to the default)',
  '`/chime ask off`: no sound when Claude asks you something or needs your OK',
  '`/chime voice on`: also chime during a live-voice chat (off by default)',
  `Sounds: ${Object.keys(SOUNDS).join(', ')}`,
].join('\n')

const describe = (settings: Settings, own: string | undefined) =>
  [
    !settings.isOn
      ? 'Chime is **off**.'
      : settings.afterSeconds === 0
        ? 'Chime is **on** for every reply.'
        : `Chime is **on** for replies that take ${settings.afterSeconds}s or more.`,
    `Reply sound: ${settings.sound}${own === undefined ? '' : ` · this chat: ${own}`} · needs you: ${settings.isAskOn ? settings.askSound : 'off'} · during voice chats: ${settings.isQuietDuringVoice ? 'quiet' : 'on'}`,
    '',
    HELP,
  ].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'chime',
      description: 'A sound when Claude finishes a longer reply or needs you',
      argumentHint: '[on|off|test|after <seconds>|sound <name> [here]]',
      immediate: true,
    })

    return started
  })

  on('command.run', { command: 'chime' }, async ($, e) => {
    const [word = '', value = '', where = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const settings = await loadSettings($)

    if (word === '') {
      return { text: describe(settings, await chatSound($)) }
    }

    if (word === 'on' || word === 'off') {
      await saveSettings($, { ...settings, isOn: word === 'on' })

      return { text: word === 'on' ? 'Chime on.' : 'Chime off. `/chime on` brings it back.' }
    }

    if (word === 'test') {
      const sound = await replySound($, settings)
      await play($, sound)

      return { text: `That was "${sound}". \`/chime sound <name>\` picks another.` }
    }

    if (word === 'after') {
      const seconds = Number(value)

      if (value === '' || !Number.isFinite(seconds) || seconds < 0) {
        return { text: 'Give a number of seconds: `/chime after 30`' }
      }

      const rounded = Math.round(seconds)
      await saveSettings($, { ...settings, afterSeconds: rounded })

      return { text: rounded === 0 ? 'Chiming after every reply.' : `Chiming for replies that take ${rounded}s or more.` }
    }

    // One chat's own sound, so you can tell by ear which chat finished.
    if (word === 'sound' && where === 'here') {
      if (value === 'default') {
        await setChatSound($, undefined)

        return { text: `This chat uses the default sound again ("${settings.sound}").` }
      }

      if (!(value in SOUNDS)) {
        return { text: `Pick one of: ${Object.keys(SOUNDS).join(', ')}, or \`default\`` }
      }

      await setChatSound($, value)
      await play($, value)

      return { text: `This chat's reply sound is now "${value}". Other chats keep "${settings.sound}".` }
    }

    if (word === 'sound' || word === 'ask-sound') {
      if (!(value in SOUNDS)) {
        return { text: `Pick one of: ${Object.keys(SOUNDS).join(', ')}` }
      }

      await saveSettings($, word === 'sound' ? { ...settings, sound: value } : { ...settings, askSound: value })
      await play($, value)

      return { text: `${word === 'sound' ? 'Reply' : '"Needs you"'} sound set to "${value}".` }
    }

    if (word === 'ask' && (value === 'on' || value === 'off')) {
      await saveSettings($, { ...settings, isAskOn: value === 'on' })

      return { text: value === 'on' ? 'Chiming when Claude needs you.' : 'No sound when Claude needs you.' }
    }

    if (word === 'voice' && (value === 'on' || value === 'off')) {
      await saveSettings($, { ...settings, isQuietDuringVoice: value === 'off' })

      return { text: value === 'on' ? 'Chiming during voice chats too.' : 'Quiet during voice chats.' }
    }

    return { text: HELP }
  })

  // A reply in the main conversation has finished.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)

    if (e.agentId === undefined && !e.isAborted) {
      void (async () => {
        const settings = await loadSettings($)

        if (e.durationMs >= settings.afterSeconds * 1000 && (await shouldPlay($, settings))) {
          await play($, await replySound($, settings))
        }
      })().catch(() => {})
    }

    return done
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    askingSound($, e.agentId)

    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    askingSound($, e.agentId)

    return next(e)
  })

  // Permission prompts, where the engine reports them.
  on('classic.Notification', async ($, e, next) => {
    const done = await next(e)

    if (e.notification_type === 'permission_prompt') {
      void (async () => {
        const settings = await loadSettings($)

        if (settings.isAskOn && (await shouldPlay($, settings))) {
          await play($, settings.askSound)
        }
      })().catch(() => {})
    }

    return done
  })
}
