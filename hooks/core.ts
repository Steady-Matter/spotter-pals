// Pure data: defaults, reducers, formatting and layout math. Nothing here touches `$`, so every
// behaviour is testable directly (the test kit cannot raise a subagent's tool call inside a
// call; these functions are what the hooks apply).
import type { AgentCard, Main, Pal, PalLook, Plan, Receipt, ToolNote, Turn, View } from '../types'

// ---------------------------------------------------------------- defaults

export const DEFAULT_MAIN: Main = { isRunning: false, lastRequestAt: 0, cacheTtlMs: 3_600_000 }
export const DEFAULT_TURN: Turn = { edits: 0, errors: 0, startedAt: 0, costAtStart: null }
export const DEFAULT_VIEW: View = { expanded: null }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored object merged over its defaults, so a value with a field missing still reads. */
export const normalize = <T extends object>(def: T, stored: unknown): T =>
  isObject(stored) ? ({ ...def, ...stored } as T) : def

/** A stored list, or empty when what is stored is not a list. */
export const listOf = <T>(stored: unknown): T[] => (Array.isArray(stored) ? (stored as T[]) : [])

export const normalizeCard = (stored: unknown): AgentCard =>
  normalize<AgentCard>(
    {
      id: '',
      type: 'agent',
      model: '',
      description: '',
      status: 'running',
      spawnedAt: 0,
      endedAt: null,
      ctx: 0,
      steps: 0,
      lastStop: null,
      tools: [],
      answer: '',
      stepDone: null,
      stepTotal: null,
      stepNote: '',
    },
    stored,
  )

// ---------------------------------------------------------------- config

export type Config = { motion: boolean; openOnStart: boolean }

/** The plugin's `/config` values, read leniently: anything malformed falls back to the default. */
export const parseConfig = (o: Readonly<Record<string, unknown>>): Config => ({
  motion: o.motion !== 'off',
  openOnStart: o.openOnStart !== false,
})

/** The person's own theme colours, by key: they follow light, dark and colour-blind themes. */
export const C = {
  main: 'claude',
  agent: 'suggestion',
  good: 'success',
  amber: 'warning',
  warn: 'error',
  dim: 'inactive',
  faint: 'subtle',
  text: 'text',
} as const

// ---------------------------------------------------------------- formatting

/**
 * A model id as people say it, from any provider's spelling: `claude-opus-5-5[1m]` → `Opus 5.5 1M`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Sonnet 4.5`, `claude-3-5-haiku-20241022` →
 * `Haiku 3.5`. Anything else is shown as given, cut to 22 characters.
 */
export const prettyModel = (id: string) => {
  if (!id) return '—'
  const cap = (f: string) => f.charAt(0).toUpperCase() + f.slice(1)
  const big = /\[1m\]|-1m\b/i.test(id) ? ' 1M' : ''
  const now = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?![\d])/i.exec(id)
  if (now?.[1] && !/^\d/.test(now[1])) return `${cap(now[1].toLowerCase())} ${now[2]}${now[3] ? `.${now[3]}` : ''}${big}`
  const old = /claude-(\d+)(?:-(\d))?-([a-z]+)/i.exec(id)
  if (old?.[3]) return `${cap(old[3].toLowerCase())} ${old[1]}${old[2] ? `.${old[2]}` : ''}${big}`
  return shorten(id, 22)
}

export const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return n <= 0 ? '' : one.length > n ? `${one.slice(0, Math.max(0, n - 1)).trimEnd()}…` : one
}

export const kTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** A running clock as the live cards draw it: m:ss, or XhYY past an hour. */
export const fmtTimer = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** `1 error`, `2 errors`. */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)

// ---------------------------------------------------------------- redaction

const SECRETS: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]

/** What an agent's details may store: credentials masked before anything is written to state. */
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// ---------------------------------------------------------------- tools

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const TOOL_WORDS: Record<string, string> = {
  Bash: 'Command',
  PowerShell: 'Command',
  Read: 'Read file',
  Edit: 'Edit file',
  Write: 'Write file',
  NotebookEdit: 'Edit notebook',
  Glob: 'Find files',
  Grep: 'Search text',
  WebFetch: 'Open web page',
  WebSearch: 'Web search',
  Agent: 'Start agent',
  Skill: 'Use skill',
  ToolSearch: 'Look up a tool',
}

/** A tool's name in plain words: `Bash` → `Command`, `mcp__chrome__open_url` → `chrome: open url`. */
const toolWords = (tool: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  return TOOL_WORDS[tool] ?? (mcp ? `${mcp[1] ?? ''}: ${(mcp[2] ?? '').replace(/_/g, ' ')}` : tool)
}

/** One plain line saying what a call was about: its command, path, pattern or search; redacted. */
export const describeInput = (tool: string, input: unknown) => {
  const i = isObject(input) ? input : {}
  const path = typeof i.file_path === 'string' ? i.file_path.split(/[\\/]/).slice(-2).join('/') : ''
  const text = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '')
  const what = text('command') || path || text('pattern') || text('url') || text('query') || text('skill') || text('description')
  return what ? `${toolWords(tool)}: ${redact(what)}` : toolWords(tool)
}

// ---------------------------------------------------------------- turn and receipt

/**
 * The turn after one tool call. Errors count in the main loop only (a subagent's failure is its
 * own); edits count from every loop.
 */
export const afterCall = (t: Turn, c: { inSubagent: boolean; hasFailed: boolean; isEdit: boolean }): Turn => ({
  ...t,
  errors: t.errors + (!c.inSubagent && c.hasFailed ? 1 : 0),
  edits: t.edits + (c.isEdit ? 1 : 0),
})

export const receiptOf = (
  t: Turn,
  o: { durationMs: number; agentsSince: number; costNow: number | null; reason: string; streakBefore?: number },
): Receipt => ({
  durationMs: o.durationMs,
  agents: o.agentsSince,
  edits: t.edits,
  errors: t.errors,
  costDelta: o.costNow !== null && t.costAtStart !== null && o.costNow - t.costAtStart >= 0.005 ? o.costNow - t.costAtStart : null,
  reason: o.reason,
  streak: o.reason === 'answer' && t.errors === 0 ? (o.streakBefore ?? 0) + 1 : 0,
})

export const normalizeReceipt = (stored: unknown): Receipt | null =>
  isObject(stored) ? normalize<Receipt>({ durationMs: 0, agents: 0, edits: 0, errors: 0, costDelta: null, reason: 'answer', streak: 0 }, stored) : null

/**
 * The last reply as one headline: the single thing worth knowing about it, said with a wink.
 * Every number in it is the receipt's own; `tone` picks the colour.
 */
export const receiptHeadline = (r: Receipt): { text: string; tone: 'good' | 'bad' | 'plain' } => {
  const took = fmtDuration(r.durationMs)
  if (r.reason !== 'answer') return { text: r.reason === 'aborted' ? `Stopped early after ${took}` : `This one did not finish (${took})`, tone: 'bad' }
  if (r.errors >= 3) return { text: `${r.errors} errors hit. It finished anyway.`, tone: 'bad' }
  if (r.errors > 0) return { text: `${plural(r.errors, 'stumble')}, still landed it`, tone: 'plain' }
  if (r.agents >= 2) return { text: `${r.agents} Pals went in. Zero errors came out.`, tone: 'good' }
  if (r.durationMs >= 600_000) return { text: `A ${Math.round(r.durationMs / 60_000)}-minute marathon, zero errors`, tone: 'good' }
  if (r.edits === 0 && r.agents === 0) {
    return { text: r.durationMs < 10_000 ? `Answered in ${took}. Blink and you missed it.` : 'Just talk: no files were changed', tone: 'plain' }
  }
  // One helper and no edits: there are no file changes to count.
  if (r.edits === 0) return { text: '1 Pal went in. Zero errors came out.', tone: 'good' }
  if (r.edits >= 5) return { text: `${r.edits} file changes, zero errors. Big one.`, tone: 'good' }
  return { text: `Clean run: ${plural(r.edits, 'file change')}, zero errors`, tone: 'good' }
}

// ---------------------------------------------------------------- agents

type StepUsage = { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | null

/** A card after one of its model requests: its context is the latest step's whole input. */
export const applyStep = (c: AgentCard, s: { model: string; usage: StepUsage; stopReason: string | null }): AgentCard => {
  const u = s.usage ?? {}
  const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  return {
    ...c,
    model: c.model || s.model,
    steps: c.steps + 1,
    ctx: ctx > 0 ? ctx : c.ctx,
    lastStop: s.stopReason,
  }
}

export const noteTool = (c: AgentCard, n: ToolNote): AgentCard => ({ ...c, tools: [...c.tools, n].slice(-12) })

/** Swimlane geometry: each agent's bar on one shared axis from the first spawn to now. */
export const lanes = (cards: AgentCard[], now: number, width: number) => {
  const start = Math.min(...cards.map(c => c.spawnedAt).filter(n => n > 0), now)
  const span = Math.max(1, now - start)
  return cards.map(c => {
    const from = Math.floor(((Math.max(c.spawnedAt, start) - start) / span) * width)
    const to = Math.max(from + 1, Math.ceil((((c.endedAt ?? now) - start) / span) * width))
    return { id: c.id, before: Math.min(from, width), bar: Math.min(to, width) - Math.min(from, width), after: width - Math.min(to, width) }
  })
}

/** A card's title row: the task in the agent's own words, the type only when there is none. */
export const cardTitle = (c: AgentCard) => c.description || c.type

/** A title split over two rows at a word boundary: `first` cells on row one, `rest` on row two. */
export const titleLines = (title: string, first: number, rest: number): [string, string] => {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= first) return [t, '']
  // Break at a space, or else just after a - : / or _, so a name like read:projects-mods is not cut mid-word.
  const space = t.lastIndexOf(' ', first)
  const mark = Math.max(...['-', ':', '/', '_'].map(m => t.lastIndexOf(m, first - 1) + 1))
  const at = space > 0 ? space : mark > 1 ? mark : first
  return [t.slice(0, at).trim(), shorten(t.slice(at), rest)]
}

// ---------------------------------------------------------------- plan (the bar above the prompt)

const DEFAULT_PLAN: Plan = { title: 'Working', total: 0, done: 0, isFinished: false, step: '', startedAt: 0, endedAt: null }

export const normalizePlan = (stored: unknown): Plan | null => (isObject(stored) ? normalize(DEFAULT_PLAN, stored) : null)

const count = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : fallback)

/**
 * The plan after one `progress` call at `now`. Fields left out keep their value; a new title, or
 * a call after the last plan finished, starts a fresh plan so counts never carry over.
 */
export const mergePlan = (prev: Plan | null, input: unknown, now = 0): Plan => {
  const i = isObject(input) ? input : {}
  const title = typeof i.title === 'string' ? shorten(i.title, 60) : ''
  const isFresh = !prev || prev.isFinished || (title !== '' && title !== prev.title)
  const base = isFresh ? { ...DEFAULT_PLAN, startedAt: now } : prev
  const total = count(i.total, base.total)
  const done = count(i.done, base.done)
  const isFinished = i.finished === true
  return {
    title: title || base.title,
    total,
    done: total > 0 ? Math.min(total, done) : done,
    isFinished,
    step: isFinished ? '' : typeof i.step === 'string' ? shorten(i.step, 40) : base.step,
    startedAt: base.startedAt,
    endedAt: isFinished ? now : null,
  }
}

export const planRatio = (p: Plan) => (p.isFinished ? 1 : p.total > 0 ? p.done / p.total : 0)

const planTook = (p: Plan) => (p.endedAt !== null && p.startedAt > 0 && p.endedAt >= p.startedAt ? fmtDuration(p.endedAt - p.startedAt) : '')

export const planLabel = (p: Plan) =>
  p.isFinished ? (planTook(p) ? `Done in ${planTook(p)}` : 'Done') : p.total > 0 ? `Steps ${p.done}/${p.total}` : 'Working'

/** The few words beside the title: the step under way when Claude named it, a nudge otherwise. */
export const planHype = (p: Plan) => {
  if (p.isFinished) return 'Nailed it'
  if (p.step) return p.step
  if (p.total <= 0) return 'On it'
  if (p.done === 0) return 'Warming up'
  if (p.done >= p.total) return 'Wrapping up'
  if (p.total - p.done === 1) return 'One step left'
  return planRatio(p) >= 0.75 ? 'Home stretch' : planRatio(p) >= 0.5 ? 'Past halfway' : 'Rolling'
}

/** The bar as the terminal draws it: █ filled, ░ empty. */
export const planBar = (p: Plan, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round(width * planRatio(p))))
  return '█'.repeat(full) + '░'.repeat(width - full)
}

// ---------------------------------------------------------------- Pals (one per agent, picked by its job)

/** A helper agent's own plan after one of its `progress` calls: the count on its card. */
export const mergeAgentSteps = (c: AgentCard, input: unknown): AgentCard => {
  const i = isObject(input) ? input : {}
  const total = count(i.total, c.stepTotal ?? 0)
  const done = i.finished === true && total > 0 ? total : count(i.done, c.stepDone ?? 0)
  const note = typeof i.step === 'string' ? shorten(i.step, 40) : typeof i.title === 'string' && c.stepTotal === null ? shorten(i.title, 40) : c.stepNote
  return { ...c, stepTotal: total, stepDone: total > 0 ? Math.min(total, done) : done, stepNote: i.finished === true ? '' : note }
}

/** `2/5` when the agent reports a plan of its own, null when it does not. */
export const agentSteps = (c: AgentCard) => (c.stepTotal !== null && c.stepTotal > 0 ? `${c.stepDone ?? 0}/${c.stepTotal}` : null)

export const agentRatio = (c: AgentCard) => (c.stepTotal !== null && c.stepTotal > 0 ? Math.min(1, (c.stepDone ?? 0) / c.stepTotal) : null)

// First match wins, so the order is the tie-break: "review the build" is checking, Depresso's job.
const PAL_RULES: [Pal, RegExp][] = [
  ['vixy', /explor|search|find|scout|archaeolog|research|look ?up|locat|guide|map\b|\bread|pull|fetch|scan|probe|trace|inventor|sweep|gather|collect|crawl|hunt|brows|survey|\bsourc|extract|\blist\b|recon/i],
  ['depresso', /review|verif|audit|check|inspect|test|debug|investigat|diagnos|analy[sz]|assess|measur|compar|classif|benchmark|evaluat|validat|\bqa\b|council|baseline|critiq|judg|grad(e|ing)|\bseat\b|\bcount|bench|\brank|evidence|proof|feasib/i],
  ['hoocrates', /plan|architect|strateg|design the|spec\b|outlin|roadmap|propos|scope|brainstorm/i],
  ['lifmunk', /design|asset|document|write|draft|\bdocs?\b|copy|styl|summar|digest|compil|consolidat|\brecord\b|handoff|runbook|caption|script|\bnotes?\b|polish|revis/i],
  ['foxparks', /quick|fast|status ?line|rename|format|tidy|remov|delet|clean|\bdrop\b|retir|trim|\bmove\b|prune/i],
  ['anubis', /build|implement|fix|engineer|refactor|code|migrat|edit|appl|\badd\b|chang|creat|set ?up|wire|\b(re)?run\b|split|finish|install|updat|\bport\b|integrat|patch|backtest|convert|generat/i],
]

/** Types that say nothing about the job: the task description decides. */
const GENERIC_TYPES = /^(general-purpose|claude|agent|fork)$/i

/** A type names its job in a word, so the rules apply in their order. */
const palFor = (text: string) => PAL_RULES.find(([, re]) => re.test(text))?.[0] ?? null

/** A task is a sentence: the job is its first telling word ("Add tests" builds, "Test the add" checks). */
const palForTask = (text: string): Pal | null => {
  let best: { k: Pal; at: number } | null = null
  for (const [k, re] of PAL_RULES) {
    const at = text.search(re)
    if (at >= 0 && (!best || at < best.at)) best = { k, at }
  }
  return best?.k ?? null
}

/**
 * The Pal for an agent: its type decides when the type names a job (Explore, a reviewer), its
 * task description otherwise; a small fast model with nothing else to go on is Foxparks, and
 * anything left is building, the commonest job, so every agent has a Pal.
 */
export const palOf = (c: Pick<AgentCard, 'type' | 'description' | 'model'>): Pal =>
  (GENERIC_TYPES.test(c.type) ? null : palFor(c.type)) ?? palForTask(c.description) ?? (/haiku/i.test(c.model) ? 'foxparks' : 'anubis')

/** Each Pal's name, the job it stands for, a terminal stand-in for its drawing, and its accent colour. */
export const PALS: Record<Pal, { name: string; job: string; emoji: string; color: string }> = {
  vixy: { name: 'Vixy', job: 'scouting', emoji: '🦊', color: '#E0A526' },
  depresso: { name: 'Depresso', job: 'checking', emoji: '🐨', color: '#5B9BD5' },
  anubis: { name: 'Anubis', job: 'building', emoji: '🐺', color: '#E08A3A' },
  lifmunk: { name: 'Lifmunk', job: 'writing', emoji: '🌿', color: '#5FBF8F' },
  hoocrates: { name: 'Hoocrates', job: 'planning', emoji: '🦉', color: '#8F8CF4' },
  foxparks: { name: 'Foxparks', job: 'quick job', emoji: '🔥', color: '#E05A5A' },
}

/** About one agent in twenty has a Lucky Pal; the same agent always gets the same answer. It shows once the agent is done. */
export const isLucky = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 20 === 0

/**
 * How an agent's Pal looks now. It is an egg until the agent has done something, then grows with
 * the agent's own plan when it reports one and with its steps when it does not, and is fully
 * grown once the agent is done, which is also when a Lucky one shows it: every Pal grows the
 * same way first. An agent that failed or was stopped has a knocked-out Pal.
 */
export const palLook = (c: AgentCard): PalLook => {
  const ratio = agentRatio(c)
  const growing = ratio !== null ? (ratio <= 0 ? 0 : ratio < 0.5 ? 1 : 2) : c.steps === 0 ? 0 : c.steps < 5 ? 1 : 2
  return { stars: c.status === 'done' ? 4 : growing, isLucky: c.status === 'done' && isLucky(c.id), isDown: c.status === 'failed' || c.status === 'stopped' }
}

/** The Pal in words: `Vixy · scouting`, `Egg · incubating`, `Lucky Lifmunk · writing`, or that it is knocked out. */
export const palWords = (k: Pal, look: PalLook) =>
  look.isDown
    ? { name: `✗ ${PALS[k].name} knocked out`, job: '' }
    : look.stars === 0
      ? { name: 'Egg', job: 'incubating' }
      : { name: `${look.isLucky ? 'Lucky ' : ''}${PALS[k].name}`, job: PALS[k].job }

/** The bar's own Pal: an egg until the first step is done, then grown, and Lucky once the job is finished. */
export const planLook = (p: Plan): PalLook => ({ stars: p.isFinished ? 4 : p.done > 0 ? 2 : 0, isLucky: p.isFinished, isDown: false })

/** The terminal's stand-in for the drawing: an egg, the Pal's emoji (sparkling when Lucky), or a skull. */
export const palEmoji = (k: Pal, look: PalLook) => (look.isDown ? '💀' : look.stars === 0 ? '🥚' : `${PALS[k].emoji}${look.isLucky ? '✨' : ''}`)

// ---------------------------------------------------------------- the session box

/**
 * How long the prompt cache lasts, read from what a request wrote to it: five minutes when it
 * wrote only five-minute entries, an hour when it wrote hour ones, the last known value otherwise.
 */
export const cacheTtlOf = (usage: unknown, previous: number): number => {
  const w = (usage as { cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } } | null)?.cache_creation
  if ((w?.ephemeral_1h_input_tokens ?? 0) > 0) return 3_600_000
  if ((w?.ephemeral_5m_input_tokens ?? 0) > 0) return 300_000
  return previous
}

/** The cache line for the time left on it. `hooks/cache.tsx` draws the same three cases as it counts down. */
export const cacheLabel = (msLeft: number): { text: string; tone: 'plain' | 'soon' | 'cold' } => {
  const min = Math.ceil(msLeft / 60_000)
  if (min <= 0) return { text: 'cold · next message re-reads it all', tone: 'cold' }
  return { text: `warm · ~${min} min left`, tone: min <= 10 ? 'soon' : 'plain' }
}

export const limitLabel = (kind: string) => (kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? 'Weekly limit' : kind.replace(/_/g, ' '))
