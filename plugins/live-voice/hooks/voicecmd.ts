// Turning what the person said into an action: a voice command handled right here, or a
// question for Claude.

export type VoiceCommand =
  | { kind: 'resume' }
  | { kind: 'stop' }
  | { kind: 'pause' }
  | { kind: 'faster' }
  | { kind: 'slower' }
  | { kind: 'repeat' }
  | { kind: 'back' }
  | { kind: 'skip' }
  | { kind: 'restart' }
  | { kind: 'catchup' }
  | { kind: 'cancel' }
  | { kind: 'end' }
  | { kind: 'mute' }
  | { kind: 'ack' }
  | { kind: 'readFrom'; topic: string }
  | { kind: 'question'; text: string }

/** Lowercase words only: punctuation dropped, curly apostrophes straightened. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEAD = /^(?:(?:hey|ok|okay|so|um|uh|alright|all right|now|and|please|claude)\s+)+/
const TAIL = /(?:\s+(?:please|now|then|thanks|thank you|a bit|a little|a little bit|more))+$/

const RULES: Array<[RegExp, VoiceCommand['kind']]> = [
  [/^(?:continue|go on|keep going|carry on|resume|go ahead|where were we|keep reading|continue reading|you can continue|back to (?:it|where we were|the answer))$/, 'resume'],
  [/^(?:stop|stop reading|stop it|be quiet|quiet|that's enough|enough|stop talking|shush)$/, 'stop'],
  [/^(?:pause|wait|hold on|hang on|one (?:sec|second|moment)|just a (?:sec|second|moment))$/, 'pause'],
  [/^(?:faster|speed (?:it )?up|go faster|a bit faster|read faster|talk faster)$/, 'faster'],
  [/^(?:slower|slow (?:it )?down|go slower|a bit slower|read slower|talk slower)$/, 'slower'],
  [/^(?:repeat(?: that)?|say (?:that|it) again|again|come again|what did you say|what was that)$/, 'repeat'],
  [/^(?:go back|back up|previous|go back one|one back)$/, 'back'],
  [/^(?:skip|next|skip (?:that|this|ahead|it)|move on)$/, 'skip'],
  [/^(?:read (?:it|that|the answer|the last answer) again|read (?:the|your) (?:last )?answer|start over|from the (?:top|beginning|start))$/, 'restart'],
  [/^(?:catch me up|catch me up on (?:this|this chat|everything)|give me a (?:recap|summary)|recap)$/, 'catchup'],
  [/^(?:cancel|never ?mind|forget it|ignore that|don't send (?:that|it))$/, 'cancel'],
  [/^(?:end|stop|turn off|close|exit) (?:the )?(?:voice|voice chat|voice mode|talk mode|live voice)$/, 'end'],
  [/^(?:mute|mute (?:the )?mic|stop listening|mic off)$/, 'mute'],
  [/^(?:ok|okay|got it|thanks|thank you|cool|great|nice|alright|all right|perfect|i see|makes sense|understood)$/, 'ack'],
]

const READ_FROM = /^(?:read|start|go|jump|skip|take me)\s+(?:back\s+)?(?:to|from|at)\s+(?:the\s+)?(?:part|section|bit|point|piece)?\s*(?:about|on|where|with|that says)?\s*(.+)$/

export function parseCommand(text: string): VoiceCommand {
  const full = normalize(text)
  const core = full.replace(LEAD, '').replace(TAIL, '').trim()
  for (const [pattern, kind] of RULES) {
    if (pattern.test(core) || pattern.test(full)) return { kind } as VoiceCommand
  }
  const from = core.match(READ_FROM)
  if (from?.[1] && from[1].split(' ').length <= 8) return { kind: 'readFrom', topic: from[1] }
  return { kind: 'question', text: text.trim() }
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'about', 'where', 'you', 'that', 'it', 'is', 'part', 'bit', 'with', 'for', 'we'])

/** The sentence a topic like "the flagged charges" best points at, or -1. */
export function findTopic(sentences: readonly string[], topic: string): number {
  const words = normalize(topic).split(' ').filter(w => w && !STOP.has(w))
  if (!words.length) return -1
  const stems = words.map(w => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, '') : w))
  let best = -1
  let bestScore = 0
  sentences.forEach((sentence, i) => {
    const s = ` ${normalize(sentence)} `
    const score = stems.reduce((n, stem) => n + (s.includes(` ${stem}`) ? 1 : 0), 0)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return bestScore >= Math.max(1, Math.ceil(stems.length / 2)) ? best : -1
}
