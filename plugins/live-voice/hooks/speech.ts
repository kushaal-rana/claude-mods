// Turning Claude's markdown into sentences that sound right out loud.
// Code and tables become a short spoken pointer; links, paths, emphasis and emoji are tidied.

const LANGS: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', typescript: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  javascript: 'JavaScript', py: 'Python', python: 'Python', sh: 'shell', bash: 'shell', zsh: 'shell',
  shell: 'shell', console: 'shell', json: 'JSON', yaml: 'YAML', yml: 'YAML', swift: 'Swift', sql: 'SQL',
  html: 'HTML', css: 'CSS', md: 'markdown', markdown: 'markdown', diff: 'diff', toml: 'TOML', go: 'Go',
  rust: 'Rust', rs: 'Rust', java: 'Java', kotlin: 'Kotlin', ruby: 'Ruby', rb: 'Ruby', xml: 'XML',
}

const ABBREVIATIONS = /(?:^|\s)(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx|incl|fig|jr|sr|inc|ltd|co)\.$/i

/** A path or file reference said the way a person would: just the file name. */
function shortPath(text: string): string {
  return text.replace(/(?:~|\.{1,2})?\/(?:[\w.@ -]+\/)*([\w.@-]+)/g, (_, last: string) => last)
}

function spokenCode(code: string): string {
  const trimmed = code.trim()
  if (/[\\/]/.test(trimmed)) return shortPath(trimmed)
  if (trimmed.length > 40) return 'a command shown on screen'
  return trimmed
}

function ensureStop(text: string): string {
  const t = text.trim()
  if (!t) return t
  return /[.!?:;]$/.test(t) ? t.replace(/:$/, '.') : `${t}.`
}

/** Inline markdown to plain spoken text. */
export function tidyInline(line: string): string {
  let t = line
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/<https?:\/\/[^>]+>/g, 'a link')
  t = t.replace(/https?:\/\/\S+/g, 'a link')
  t = t.replace(/`([^`]+)`/g, (_, code: string) => spokenCode(code))
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, '')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2')
  t = t.replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,;:!?]|$)/g, '$1$2')
  t = t.replace(/~~([^~]+)~~/g, '$1')
  t = shortPath(t)
  t = t.replace(/\p{Extended_Pictographic}️?/gu, '')
  t = t.replace(/\s+[—–]\s+/g, ', ').replace(/[—–]/g, ', ')
  t = t.replace(/\s*→\s*/g, ' to ').replace(/\s&\s/g, ' and ')
  t = t.replace(/\s{2,}/g, ' ')
  return t.trim()
}

/** Markdown to spoken units: headings, list items and paragraphs, code and tables replaced. */
export function spokenUnits(markdown: string): string[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const units: string[] = []
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) units.push(ensureStop(tidyInline(paragraph.join(' '))))
    paragraph = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)/)
    if (fence) {
      flush()
      let j = i + 1
      while (j < lines.length && !(lines[j] ?? '').trim().startsWith(fence[1] ?? '```')) j++
      const n = Math.max(0, j - i - 1)
      const lang = LANGS[(fence[2] ?? '').toLowerCase()] ?? ''
      const size = n <= 3 ? 'a short' : `a ${n}-line`
      units.push(`There's ${size} ${lang ? `${lang} ` : ''}code block here. Have a look on screen.`)
      i = j
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush()
      let j = i
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j] ?? '')) j++
      const rows = lines.slice(i, j).filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).length
      const data = Math.max(0, rows - 1)
      units.push(`There's a table here with ${data} row${data === 1 ? '' : 's'}. Have a look on screen.`)
      i = j - 1
      continue
    }
    if (!line.trim()) { flush(); continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); continue }
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
    if (heading) { flush(); units.push(ensureStop(tidyInline(heading[1] ?? ''))); continue }
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (item) { flush(); units.push(ensureStop(tidyInline(item[1] ?? ''))); continue }
    paragraph.push(line.replace(/^\s*>\s?/, '').trim())
  }
  flush()
  return units.filter(u => u.replace(/[.!?\s]/g, '').length > 0)
}

/** Splits text into sentences, keeping abbreviations and decimals whole, and halving very long ones. */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  for (let k = 0; k < text.length; k++) {
    const c = text[k]
    if (c !== '.' && c !== '!' && c !== '?') continue
    let end = k + 1
    while (end < text.length && /["')\]]/.test(text[end] ?? '')) end++
    if (end < text.length && !/\s/.test(text[end] ?? ' ')) continue
    const next = text.slice(end).trimStart()[0]
    if (next !== undefined && !/[A-Z0-9"'(\[]/.test(next)) continue
    const piece = text.slice(start, end)
    if (c === '.' && (ABBREVIATIONS.test(piece) || /(?:^|\s)[A-Z]\.$/.test(piece))) continue
    out.push(piece.trim())
    start = end
  }
  if (start < text.length) out.push(text.slice(start).trim())
  return out.flatMap(halve).filter(s => s.length > 0)
}

function halve(sentence: string): string[] {
  if (sentence.length <= 240) return [sentence]
  const mid = Math.floor(sentence.length / 2)
  let cut = -1
  for (const mark of ['; ', ', ', ' and ', ' but ']) {
    let best = -1
    for (let p = sentence.indexOf(mark); p !== -1; p = sentence.indexOf(mark, p + 1)) {
      if (best === -1 || Math.abs(p - mid) < Math.abs(best - mid)) best = p
    }
    if (best > 40 && best < sentence.length - 40) { cut = best + (mark === '; ' || mark === ', ' ? 1 : 0); break }
  }
  if (cut === -1) return [sentence]
  return [...halve(sentence.slice(0, cut).trim()), ...halve(sentence.slice(cut).trim())]
}

/** Markdown answer to the list of sentences the voice reads. */
export function toSentences(markdown: string): string[] {
  return spokenUnits(markdown).flatMap(splitSentences)
}

/** Plain spoken text (already written for the ear) to sentences. */
export function plainSentences(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(p => tidyInline(p.replace(/\n/g, ' ')))
    .filter(Boolean)
    .flatMap(splitSentences)
}

/** Lowercased letters and digits only, for matching a selection against text. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The part of `markdown` from where `selection` starts, or null when it isn't in there. */
export function fromSelection(markdown: string, selection: string): string | null {
  const probe = (selection.trim().split('\n')[0] ?? '').trim().slice(0, 60)
  if (probe.length < 3) return null
  const at = markdown.indexOf(probe)
  if (at !== -1) return markdown.slice(at)
  const words = fold(probe).split(' ').slice(0, 6).join(' ')
  const lines = markdown.split('\n')
  for (let k = 0; k < lines.length; k++) {
    if (fold(lines[k] ?? '').includes(words)) return lines.slice(k).join('\n')
  }
  return null
}
