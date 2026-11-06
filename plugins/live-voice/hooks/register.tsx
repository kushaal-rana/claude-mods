// Live Voice: talk with Claude Code out loud.
// A card above the prompt box reads Claude's main answers in a natural local voice and listens
// to you: talk over it to interrupt, ask a question, or give a command ("continue", "slower").
// The audio lives in a local helper (~/.claude-voice/bin/claude-voice-helper) the mod starts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { VoicePhase, VoiceReading } from '../types'
import { fromSelection, plainSentences, toSentences } from './speech'
import { findTopic, parseCommand } from './voicecmd'

const isOn = atom({ plugin: 'live-voice', key: 'isOn' } as const, false)
const phase = atom({ plugin: 'live-voice', key: 'phase' } as const, 'off' as VoicePhase)
const note = atom({ plugin: 'live-voice', key: 'note' } as const, '')
const reading = atom({ plugin: 'live-voice', key: 'reading' } as const, null as VoiceReading | null, { shape: 'reading-1' })
const suspended = atom({ plugin: 'live-voice', key: 'suspended' } as const, null as VoiceReading | null, { shape: 'reading-1' })
const rate = atom({ plugin: 'live-voice', key: 'rate' } as const, 1)
const DEFAULT_VOICE = 'en_us_Everly'
const voice = atom({ plugin: 'live-voice', key: 'voice' } as const, DEFAULT_VOICE)
const mode = atom({ plugin: 'live-voice', key: 'mode' } as const, 'spoken')
const workingSince = atom({ plugin: 'live-voice', key: 'workingSince' } as const, 0)
const tick = atom({ plugin: 'live-voice', key: 'tick' } as const, 0)
const micOn = atom({ plugin: 'live-voice', key: 'micOn' } as const, false)
const heard = atom({ plugin: 'live-voice', key: 'heard' } as const, '')
const sending = atom({ plugin: 'live-voice', key: 'sending' } as const, '')

const SPEEDS = ['1', '1.25', '1.5', '1.75', '2']
const VOICES = [
  { value: 'en_us_Everly', label: 'Everly' },
  { value: 'en_us_Hadley', label: 'Hadley' },
  { value: 'en_us_Miles', label: 'Miles' },
  { value: 'af_heart', label: 'Heart' },
  { value: 'am_michael', label: 'Michael' },
  { value: 'bf_emma', label: 'Emma (British)' },
]
const ACKS = ['Let me check.', 'Good question, one moment.', 'On it.', 'Let me look into that.']
const BLUE = '#4f8cff'
const SEND_DELAY_MS = 1600
const MIN_CONFIDENCE = 0.3

type Spawned = ReturnType<EngineInterface['process']['spawn']>
type SpawnEnd = { code: number | null; signal: string | null }
type HelperEvent = {
  ev?: string
  id?: string
  i?: number
  msg?: string
  engine?: string
  on?: boolean
  aec?: boolean
  barge?: boolean
  text?: string
  confidence?: number
  level?: number
  reason?: string
}

// Per-load runtime (a reload starts these over; session.start brings the helper back).
let home = ''
let socketPath = ''
let helperStream: Spawned | null = null
let helperUp = false
let pending: VoiceReading | null = null
let startedAt = 0
let lastAnswer = ''
let workTimer: Timer | null = null
let speakToken = 0
let starting = false
let sendTimer: Timer | null = null
let pendingQuestion = ''
let voiceContext: string | null = null
let ackCount = 0

const spokenPrompt = (answer: string) =>
  `(Live voice mode, not a new request.) The user is listening to you through a speaker instead of ` +
  `reading the screen. Retell your last reply, quoted below, so it sounds natural spoken aloud, the way ` +
  `you would explain it to them in person. Keep every fact, number, name, decision and question in it, ` +
  `in the same order, and add nothing new. Use short, plain sentences, and words like "first", "next" and ` +
  `"finally" in place of lists and headings. Don't read out code, commands, file paths, URLs or tables: ` +
  `say in a few words what they are and that they're on screen. No markdown, no emoji. Reply with only ` +
  `the words to speak, nothing before or after.\n\nYour last reply:\n"""\n${answer}\n"""`

const catchUpPrompt = (last: string) =>
  `(Live voice mode, not a new request.) The user wants a spoken catch-up on this whole chat, heard ` +
  `through a speaker. In about 30 to 45 seconds of speech, cover: what we set out to do, what has been ` +
  `done, where things stand right now, and what you need from them next. Plain, short spoken sentences; ` +
  `no markdown, lists, code, file paths or URLs. Reply with only the words to speak.` +
  (last ? `\n\nFor reference, your most recent reply was:\n"""\n${last}\n"""` : '')

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

async function setNote($: EngineInterface, text: string) {
  await update($, note, () => text)
}

async function helper($: EngineInterface, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!helperUp || !socketPath) return null
  try {
    const res = await $.http.fetch('http://voice/cmd', {
      method: 'POST',
      socketPath,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok ? (JSON.parse(res.text) as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// MARK: helper events

async function onHelperEvent($: EngineInterface, line: string) {
  let ev: HelperEvent
  try {
    ev = JSON.parse(line) as HelperEvent
  } catch {
    return
  }
  switch (ev.ev) {
    case 'loading':
      if (ev.engine === 'phonon' || ev.engine === 'kokoro') {
        await setNote($, `Loading the ${ev.engine === 'phonon' ? 'Phonon' : 'Kokoro'} voice…`)
      } else {
        await setNote($, 'Getting the microphone ready…')
      }
      break
    case 'ready': {
      helperUp = true
      await setNote($, '')
      if ((await read($, phase)) === 'starting') await update($, phase, () => 'ready')
      if ((await $.store.get('mic')) !== false) await helper($, { op: 'mic', on: true, aec: true })
      const queued = pending
      pending = null
      if (queued) await sayReading($, queued)
      break
    }
    case 'mic':
      await update($, micOn, () => ev.on === true)
      if (ev.on) await setNote($, '')
      break
    case 'mic_permission':
      await setNote($, 'macOS is asking to let Claude use the microphone. Click Allow.')
      break
    case 'mic_error':
      await update($, micOn, () => false)
      await setNote($, ev.msg ?? 'The microphone could not start.')
      break
    case 'mic_warning':
      await setNote($, ev.msg ?? '')
      break
    case 'speech_start':
      await update($, heard, () => '')
      await update($, phase, () => 'listening')
      break
    case 'partial':
      await update($, heard, () => ev.text ?? '')
      break
    case 'ignored':
      await update($, heard, () => '')
      if ((await read($, phase)) === 'listening') await update($, phase, () => (ev.barge ? 'speaking' : 'ready'))
      break
    case 'utterance':
      await onUtterance($, ev.text ?? '', ev.barge === true, ev.confidence ?? -1)
      break
    case 'sentence':
      await update($, reading, r => (r && r.id === ev.id ? { ...r, i: ev.i ?? r.i } : r))
      if ((await read($, phase)) !== 'listening') await update($, phase, () => 'speaking')
      break
    case 'paused':
      if ((await read($, phase)) !== 'listening') await update($, phase, () => 'paused')
      break
    case 'resumed':
      await update($, phase, () => 'speaking')
      break
    case 'done':
    case 'stopped': {
      const now = await read($, phase)
      if (now === 'speaking' || now === 'paused') await update($, phase, () => 'ready')
      if (ev.ev === 'done' && ev.id?.startsWith('r') && (await read($, suspended))) {
        await setNote($, 'Say "continue" to pick up where we left off.')
      }
      break
    }
    case 'error':
      await setNote($, ev.msg ?? 'The voice hit an error.')
      break
  }
}

// MARK: what the person said

async function onUtterance($: EngineInterface, text: string, barge: boolean, confidence: number) {
  await update($, heard, () => text)
  $.clock.after(6000, () => {
    void update($, heard, h => (h === text ? '' : h))
  })
  const back = async () => {
    if ((await read($, phase)) === 'listening') await update($, phase, () => (barge ? 'paused' : 'ready'))
  }
  if (confidence >= 0 && confidence < MIN_CONFIDENCE) {
    await setNote($, `I didn't catch that clearly ("${text}"), so I ignored it.`)
    if (barge) await helper($, { op: 'resume' })
    await back()
    return
  }
  const cmd = parseCommand(text)
  const r = await read($, reading)
  switch (cmd.kind) {
    case 'resume':
      await back()
      await resumeReading($)
      return
    case 'stop':
      await update($, suspended, () => null)
      await stopReading($)
      return
    case 'pause':
      if (!barge) await helper($, { op: 'pause' })
      await update($, phase, () => 'paused')
      await setNote($, 'Paused. Say "continue" when you are ready.')
      return
    case 'faster':
    case 'slower': {
      const now = await read($, rate)
      const next = Math.min(2, Math.max(0.75, now + (cmd.kind === 'faster' ? 0.25 : -0.25)))
      await setRate($, next)
      await setNote($, `Speed ${next}x.`)
      if (barge) await helper($, { op: 'resume' })
      await back()
      return
    }
    case 'repeat':
    case 'back':
    case 'skip':
    case 'restart': {
      await back()
      if (!r) return
      const target = cmd.kind === 'repeat' ? r.i : cmd.kind === 'back' ? r.i - 1 : cmd.kind === 'skip' ? r.i + 1 : 0
      await helper($, { op: 'seek', i: Math.max(0, target) })
      return
    }
    case 'readFrom': {
      await back()
      const source = r ?? (await read($, suspended))
      const idx = source ? findTopic(source.sentences, cmd.topic) : -1
      if (source && idx >= 0) {
        await sayReading($, { ...source, i: idx })
      } else {
        await setNote($, `I couldn't find a part about "${cmd.topic}".`)
        if (barge) await helper($, { op: 'resume' })
      }
      return
    }
    case 'catchup':
      await back()
      void catchUp($)
      return
    case 'cancel':
      await back()
      if (pendingQuestion) await cancelQuestion($)
      else if (barge) await helper($, { op: 'resume' })
      return
    case 'end':
      await turnOff($)
      return
    case 'mute':
      await back()
      await setMic($, false)
      if (barge) await helper($, { op: 'resume' })
      return
    case 'ack':
      await back()
      if (barge) await helper($, { op: 'resume' })
      return
    case 'question':
      await askClaude($, cmd.text, barge)
      return
  }
}

/** Holds the question briefly (with Cancel) so stray background talk never reaches Claude unseen. */
async function askClaude($: EngineInterface, text: string, barge: boolean) {
  const r = await read($, reading)
  const ph = await read($, phase)
  if (r && (barge || ph === 'paused') && r.id.startsWith('r')) await update($, suspended, () => ({ ...r }))
  voiceContext = r && barge ? `they interrupted you while you were reading this sentence aloud: "${r.sentences[r.i] ?? ''}"` : ''
  pendingQuestion = text
  await update($, sending, () => text)
  await update($, phase, () => 'ready')
  sendTimer?.cancel()
  sendTimer = $.clock.after(SEND_DELAY_MS, () => {
    void submitQuestion($)
  })
}

async function submitQuestion($: EngineInterface) {
  sendTimer = null
  const text = pendingQuestion
  if (!text) return
  pendingQuestion = ''
  await update($, sending, () => '')
  const busy = (await read($, workingSince)) > 0
  const ack = busy ? "I'll ask that as soon as Claude finishes this step." : ACKS[ackCount++ % ACKS.length] ?? 'On it.'
  await sayReading($, { id: `a${await $.clock.now()}`, label: '', sentences: [ack], i: 0 })
  await $.prompt.submit({ text, asUser: true })
}

async function cancelQuestion($: EngineInterface) {
  sendTimer?.cancel()
  sendTimer = null
  pendingQuestion = ''
  voiceContext = null
  await update($, sending, () => '')
  await setNote($, 'Cancelled.')
  await resumeReading($)
}

async function resumeReading($: EngineInterface) {
  const held = await read($, suspended)
  if (held) {
    await update($, suspended, () => null)
    await setNote($, '')
    await sayReading($, held)
    return
  }
  if ((await read($, phase)) === 'paused') {
    await setNote($, '')
    await helper($, { op: 'resume' })
    return
  }
  await setNote($, 'Nothing to continue right now.')
}

// MARK: the helper process

async function startHelper($: EngineInterface) {
  if (helperStream || starting) return
  starting = true
  try {
    home = home || (await $.env.get('HOME')) || ''
    const sid = (await $.session.id()).slice(0, 8)
    socketPath = `${home}/.claude-voice/run/${sid}.sock`
    const argv = [
      `${home}/.claude-voice/bin/claude-voice-helper`,
      '--socket', socketPath,
      '--voice', await read($, voice),
      '--rate', String(await read($, rate)),
    ]
    await update($, phase, () => 'starting')
    await setNote($, 'Starting the voice…')
    const stream = $.process.spawn({ argv })
    helperStream = stream
    void pump($, stream)
  } finally {
    starting = false
  }
}

/** Reads the helper's events until it exits, then says how it ended. */
async function pump($: EngineInterface, stream: Spawned) {
  const it = stream[Symbol.asyncIterator]()
  let buffer = ''
  let ended: SpawnEnd | null = null
  let failure = ''
  try {
    for (;;) {
      const step = await it.next()
      if (step.done) {
        ended = step.value as SpawnEnd
        break
      }
      if (step.value.stream !== 'stdout') continue
      buffer += step.value.text
      for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('{')) await onHelperEvent($, line)
      }
    }
  } catch (err) {
    failure = String(err).slice(0, 160)
  }
  if (helperStream !== stream) return
  helperStream = null
  helperUp = false
  await update($, micOn, () => false)
  if (!(await read($, isOn))) return
  await update($, phase, () => 'error')
  const how = failure
    ? `couldn't start (${failure})`
    : ended?.signal
      ? `crashed (${ended.signal})`
      : `stopped (exit code ${ended?.code ?? '?'})`
  await setNote($, `The voice helper ${how}. Its log is ~/.claude-voice/run/helper.log. Press Restart to try again.`)
}

async function stopHelper($: EngineInterface) {
  const stream = helperStream
  await helper($, { op: 'quit' })
  helperStream = null
  helperUp = false
  pending = null
  try {
    await stream?.return?.(undefined as never)
  } catch {
    // the child is already gone
  }
}

// MARK: reading

async function sayReading($: EngineInterface, r: VoiceReading) {
  await update($, reading, () => r)
  if (helperUp) {
    await helper($, { op: 'speak', id: r.id, sentences: r.sentences, start: r.i })
    return
  }
  pending = r
  // After a crash, wait for the person to press Restart rather than looping.
  if ((await read($, phase)) === 'error') {
    await setNote($, 'The voice helper is stopped. Press Restart and it will read this.')
    return
  }
  if (!helperStream) await startHelper($)
}

async function stopReading($: EngineInterface) {
  ++speakToken
  pending = null
  await helper($, { op: 'stop' })
  const now = await read($, phase)
  if (now === 'speaking' || now === 'paused' || now === 'preparing' || now === 'listening') {
    await update($, phase, () => 'ready')
  }
}

async function lastAssistantText($: EngineInterface): Promise<string> {
  if (lastAnswer) return lastAnswer
  const messages = await $.session.messages()
  for (let k = messages.length - 1; k >= 0; k--) {
    const m = messages[k]
    if (!m) continue
    if (m.role === 'assistant' && m.text.trim() && m.toolUses.length === 0) return m.text
  }
  return ''
}

async function readAnswer($: EngineInterface, answer: string, label = 'Latest answer') {
  const token = ++speakToken
  let sentences: string[] = []
  if ((await read($, mode)) === 'spoken') {
    await update($, phase, () => 'preparing')
    const spoken = await $.model.fork({ prompt: spokenPrompt(answer) })
    if (token !== speakToken) return
    if (spoken.isAnswered && spoken.text.trim()) sentences = plainSentences(spoken.text)
  }
  if (!sentences.length) sentences = toSentences(answer)
  if (!sentences.length || token !== speakToken) return
  await sayReading($, { id: `r${await $.clock.now()}`, label, sentences, i: 0 })
}

async function catchUp($: EngineInterface) {
  const token = ++speakToken
  await helper($, { op: 'stop' })
  await update($, phase, () => 'preparing')
  await setNote($, 'Putting a catch-up together…')
  const res = await $.model.fork({ prompt: catchUpPrompt(await lastAssistantText($)) })
  if (token !== speakToken) return
  await setNote($, '')
  if (!res.isAnswered || !res.text.trim()) {
    await update($, phase, () => 'ready')
    await setNote($, !res.isAnswered && res.reason === 'nothing-to-fork'
      ? 'Nothing to catch up on yet.'
      : 'The catch-up did not come through. Try again.')
    return
  }
  await sayReading($, { id: `r${await $.clock.now()}`, label: 'Catch-up', sentences: plainSentences(res.text), i: 0 })
}

async function readSelection($: EngineInterface) {
  const selected = await $.ui.selection()
  if (!selected?.text.trim()) {
    await setNote($, 'Select some text in the chat first, then press Read selection.')
    return
  }
  ++speakToken
  await helper($, { op: 'stop' })
  const messages = await $.session.messages()
  for (let k = messages.length - 1; k >= 0; k--) {
    const m = messages[k]
    if (!m || m.role !== 'assistant') continue
    const part = fromSelection(m.text, selected.text)
    if (part) {
      await sayReading($, { id: `r${await $.clock.now()}`, label: 'From your selection', sentences: toSentences(part), i: 0 })
      return
    }
  }
  await sayReading($, { id: `r${await $.clock.now()}`, label: 'Your selection', sentences: toSentences(selected.text), i: 0 })
}

// MARK: settings

async function setRate($: EngineInterface, value: number) {
  await update($, rate, () => value)
  await $.store.set('rate', value)
  await helper($, { op: 'rate', value })
}

async function setVoice($: EngineInterface, name: string) {
  await update($, voice, () => name)
  await $.store.set('voice', name)
  const res = await helper($, { op: 'voice', name })
  if (res && res.ok === false) await setNote($, `That voice didn't load: ${String(res.error ?? '')}`)
  else await setNote($, '')
}

async function setMode($: EngineInterface, value: string) {
  await update($, mode, () => value)
  await $.store.set('mode', value)
}

async function setMic($: EngineInterface, on: boolean) {
  await $.store.set('mic', on)
  await helper($, { op: 'mic', on, aec: true })
  if (!on) await update($, micOn, () => false)
}

async function loadPrefs($: EngineInterface) {
  const r = await $.store.get('rate')
  const v = await $.store.get('voice')
  const m = await $.store.get('mode')
  if (typeof r === 'number') await update($, rate, () => r)
  await update($, voice, () => (typeof v === 'string' ? v : DEFAULT_VOICE))
  if (typeof m === 'string') await update($, mode, () => m)
}

// MARK: on and off

async function turnOn($: EngineInterface) {
  if (await read($, isOn)) return
  await update($, isOn, () => true)
  startedAt = await $.clock.now()
  await loadPrefs($)
  await startHelper($)
  void $.session.append({ message: { type: 'system', content: [{ type: 'text', text: 'Started voice chat' }] } })
}

async function turnOff($: EngineInterface) {
  if (!(await read($, isOn))) return
  ++speakToken
  sendTimer?.cancel()
  sendTimer = null
  pendingQuestion = ''
  await stopHelper($)
  await update($, isOn, () => false)
  await update($, phase, () => 'off')
  await update($, micOn, () => false)
  await update($, heard, () => '')
  await update($, sending, () => '')
  await update($, suspended, () => null)
  await setNote($, '')
  const seconds = startedAt ? ((await $.clock.now()) - startedAt) / 1000 : 0
  void $.session.append({
    message: { type: 'system', content: [{ type: 'text', text: `Stopped voice chat · ${duration(seconds)}` }] },
  })
}

function startTicking($: EngineInterface) {
  workTimer?.cancel()
  workTimer = $.clock.every(1000, () => {
    void update($, tick, n => (n + 1) % 1_000_000)
  })
}

function stopTicking() {
  workTimer?.cancel()
  workTimer = null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({
        name: 'talk',
        description: 'Live voice chat: turn it on or off. Also: /talk catchup, /talk read',
        argumentHint: '[on|off|catchup|read]',
        immediate: true,
      })
    } catch (err) {
      $.ui.toast(`Live voice could not add /talk: ${String(err).slice(0, 120)}`)
    }
    // Everly is the default until a voice is picked from the card's menu.
    const picked = await $.store.get('voice')
    await update($, voice, () => (typeof picked === 'string' ? picked : DEFAULT_VOICE))
    // Every chat starts with voice off; the 🎙 Talk button in the bottom bar turns it on.
    await update($, isOn, () => false)
    await update($, phase, () => 'off')
    await update($, micOn, () => false)
    return started
  })

  on('command.run', { command: 'talk' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const already = await read($, isOn)
    if (arg === 'off' || (arg === '' && already)) {
      await turnOff($)
      return { text: 'Voice off.' }
    }
    await turnOn($)
    if (arg === 'catchup' || arg === 'catch up') void catchUp($)
    if (arg === 'read') void readAnswer($, await lastAssistantText($), 'Last answer')
    return { text: 'Voice on.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const origin = e.origin as { kind: string; name?: string }
    if (origin.kind === 'plugin' && origin.name === 'live-voice') {
      // A question asked out loud: tell Claude so, quietly, beside the words.
      const where = voiceContext
      voiceContext = null
      if (where === null) return next(e)
      const note = `(The user asked this out loud in live voice mode${where ? `; ${where}` : ''}. Your reply will be read aloud.)`
      return next({ ...e, context: [...(e.context ?? []), note] })
    }
    // The person typed something new: stop reading the old answer.
    if (await read($, isOn)) {
      await update($, suspended, () => null)
      await stopReading($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, workingSince, () => now)
      if (await read($, isOn)) startTicking($)
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      stopTicking()
      await update($, workingSince, () => 0)
      if (!e.isAborted && e.reason === 'answer' && e.answer.trim()) {
        lastAnswer = e.answer
        const answer = e.answer
        if (await read($, isOn)) $.clock.after(30, () => void readAnswer($, answer))
      }
    }
    return done
  })

  // A Talk button in the prompt's bottom bar, beside the app's own mode labels.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const active = await read($, isOn)
    const modes = e.props.modes
    return (
      <Box flexDirection="row" gap="sm" alignItems="center">
        {modes.length ? <Text dimColor>{modes.join(' & ')}</Text> : null}
        <Button
          key="talk"
          label={active ? '🎙 Voice on' : '🎙 Talk'}
          variant={active ? 'primary' : undefined}
          onPress={() => void (active ? turnOff($) : turnOn($))}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if (!(await read($, isOn))) return next(e)
    const Select = 'Select' in els ? els.Select : undefined

    const ph = await read($, phase)
    const r = await read($, reading)
    const held = await read($, suspended)
    const since = await read($, workingSince)
    await read($, tick)
    const now = since ? await $.clock.now() : 0
    const sp = await read($, rate)
    const vc = await read($, voice)
    const md = await read($, mode)
    const msg = await read($, note)
    const mic = await read($, micOn)
    const you = await read($, heard)
    const asking = await read($, sending)

    const where = r && r.sentences.length > 1 ? ` ${Math.min(r.i + 1, r.sentences.length)}/${r.sentences.length}` : ''
    let status: string
    if (ph === 'listening') status = 'Listening…'
    else if (ph === 'speaking') status = `Speaking${where}`
    else if (ph === 'paused') status = `Paused${where}`
    else if (ph === 'preparing') status = 'Getting it ready to speak…'
    else if (ph === 'starting') status = 'Starting the voice…'
    else if (ph === 'error') status = 'Voice stopped'
    else if (since) status = `Claude is working ${duration((now - since) / 1000)}`
    else status = mic ? 'Listening for you' : 'Voice on'
    const live = ph === 'speaking' || ph === 'preparing' || ph === 'listening'

    const cur = r ? r.sentences[r.i] ?? '' : ''
    const prev = r && r.i > 0 ? r.sentences[r.i - 1] : ''
    const nextLine = r ? r.sentences[r.i + 1] ?? '' : ''

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={live ? BLUE : undefined} borderDimColor={!live} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="sm">
          <Text color={live ? BLUE : undefined} bold>
            {ph === 'listening' ? '●' : live ? '◉' : '○'} {status}
          </Text>
          <Box flexDirection="row" gap="sm" alignItems="center">
            {ph === 'speaking' && <Button key="pause" label="Pause" onPress={() => void helper($, { op: 'pause' })} />}
            {ph === 'paused' && <Button key="resume" label="Resume" variant="primary" onPress={() => void resumeReading($)} />}
            {(ph === 'speaking' || ph === 'paused' || ph === 'preparing') && (
              <Button key="stop" label="Stop" onPress={() => void stopReading($)} />
            )}
            {ph !== 'error' && ph !== 'starting' && (
              <Button key="mic" label={mic ? 'Mute mic' : 'Unmute mic'} onPress={() => void setMic($, !mic)} />
            )}
            {Select && (
              <Select
                key="speed"
                label="Speed"
                value={String(sp)}
                options={SPEEDS.map(s => ({ value: s, label: `${s}x` }))}
                onSelect={value => void setRate($, Number(value))}
              />
            )}
            {ph === 'error' && <Button key="restart" label="Restart" variant="primary" onPress={() => void startHelper($)} />}
            <Button key="end" label="End" onPress={() => void turnOff($)} />
          </Box>
        </Box>
        {asking ? (
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text>
              Asking Claude: <Text italic>“{asking}”</Text>
            </Text>
            <Button key="send-now" label="Send now" variant="primary" onPress={() => void submitQuestion($)} />
            <Button key="cancel" label="Cancel" onPress={() => void cancelQuestion($)} />
          </Box>
        ) : null}
        {you && !asking ? (
          <Text>
            <Text dimColor>You: </Text>
            <Text italic>{you}</Text>
          </Text>
        ) : null}
        {r && cur ? (
          <Box flexDirection="column" paddingY="xs">
            {r.label ? <Text dimColor size="footnote">{r.label}</Text> : null}
            <Text wrap="wrap">
              {prev ? <Text dimColor>{prev} </Text> : null}
              <Text bold>{cur}</Text>
              {nextLine ? <Text dimColor> {nextLine}</Text> : null}
            </Text>
          </Box>
        ) : !you && !asking ? (
          <Text dimColor>
            {mic
              ? 'Just talk: ask anything, or say "continue", "slower", "go back", "catch me up". Answers are read aloud.'
              : 'Answers are read aloud when Claude finishes. Use the buttons below anytime.'}
          </Text>
        ) : null}
        {held && ph !== 'speaking' ? (
          <Box flexDirection="row" gap="sm" alignItems="center">
            <Text dimColor>
              Paused reading at {Math.min(held.i + 1, held.sentences.length)}/{held.sentences.length}.
            </Text>
            <Button key="continue" label="Continue" onPress={() => void resumeReading($)} />
          </Box>
        ) : null}
        <Box flexDirection="row" gap="sm" alignItems="center" flexWrap="wrap">
          <Button key="replay" label="Read last answer" onPress={async () => void readAnswer($, await lastAssistantText($), 'Last answer')} />
          <Button key="catchup" label="Catch me up" onPress={() => void catchUp($)} />
          <Button key="selection" label="Read selection" onPress={() => void readSelection($)} />
          <Button
            key="mode"
            label={md === 'spoken' ? 'Style: spoken' : 'Style: word for word'}
            onPress={() => void setMode($, md === 'spoken' ? 'verbatim' : 'spoken')}
          />
          {Select && (
            <Select key="voice" label="Voice" value={vc} options={VOICES} onSelect={value => void setVoice($, value)} />
          )}
        </Box>
        {msg ? <Text dimColor>{msg}</Text> : null}
      </Box>
    )
  })
}
