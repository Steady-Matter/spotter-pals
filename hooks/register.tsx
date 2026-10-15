import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentCard, Main, Plan, Receipt, Turn, View } from '../types'
import { ACCENT, BAR_HEIGHT, DONE, barSvg } from './bar'
import {
  C,
  PALS,
  DEFAULT_MAIN,
  DEFAULT_TURN,
  DEFAULT_VIEW,
  EDIT_TOOLS,
  afterCall,
  agentRatio,
  agentSteps,
  applyStep,
  cacheLabel,
  cacheTtlOf,
  cardTitle,
  palEmoji,
  palLook,
  palOf,
  palWords,
  describeInput,
  fmtDuration,
  fmtTimer,
  fmtUsd,
  kTokens,
  lanes,
  limitLabel,
  listOf,
  mergeAgentSteps,
  mergePlan,
  normalize,
  normalizeCard,
  normalizePlan,
  normalizeReceipt,
  noteTool,
  parseConfig,
  planBar,
  planHype,
  planLabel,
  planLook,
  planRatio,
  plural,
  prettyModel,
  receiptHeadline,
  receiptOf,
  shorten,
  titleLines,
} from './core'
import type { Config } from './core'
import { PAL_GRID, palSvg } from './pals'

const PANE = 'spotter'
const TITLE = 'Spotter'
const PANE_COLUMNS = 48
const PROGRESS_TOOL = 'mcp__spotter__progress'

// ---------------------------------------------------------------- state

const main = atom({ plugin: 'spotter', key: 'main' } as const, DEFAULT_MAIN)
const agents = atom({ plugin: 'spotter', key: 'agents' } as const, [])
const turn = atom({ plugin: 'spotter', key: 'turn' } as const, DEFAULT_TURN)
const receipt = atom({ plugin: 'spotter', key: 'receipt' } as const, null)
const view = atom({ plugin: 'spotter', key: 'view' } as const, DEFAULT_VIEW)
const plan = atom({ plugin: 'spotter', key: 'plan' } as const, null)

// Every read goes through these, so a value with a field missing still reads.
async function getMain($: EngineInterface): Promise<Main> {
  return normalize(DEFAULT_MAIN, await read($, main))
}
async function getCards($: EngineInterface): Promise<AgentCard[]> {
  return listOf<unknown>(await read($, agents)).map(normalizeCard)
}
async function getTurn($: EngineInterface): Promise<Turn> {
  return normalize(DEFAULT_TURN, await read($, turn))
}
async function getView($: EngineInterface): Promise<View> {
  return normalize(DEFAULT_VIEW, await read($, view))
}
async function getPlan($: EngineInterface): Promise<Plan | null> {
  return normalizePlan(await read($, plan))
}
async function getReceipt($: EngineInterface): Promise<Receipt | null> {
  return normalizeReceipt(await read($, receipt))
}

async function openPane($: EngineInterface) {
  // columns apply when docked beside the transcript, rows when seated inline above the prompt.
  return $.ui.open({ id: PANE, title: TITLE, columns: PANE_COLUMNS, rows: 8 })
}

async function resetAll($: EngineInterface) {
  await update($, main, () => DEFAULT_MAIN)
  await update($, agents, () => [])
  await update($, turn, () => DEFAULT_TURN)
  await update($, receipt, () => null)
  await update($, view, () => DEFAULT_VIEW)
  await update($, plan, () => null)
}

/** One helper's card changed in place; a no-op when there is no card with that id. */
async function updateCard($: EngineInterface, id: string, change: (c: AgentCard) => AgentCard) {
  await update($, agents, list => listOf<unknown>(list).map(normalizeCard).map(c => (c.id === id ? change(c) : c)))
}

/** The session's cost read fresh: the receipt subtracts two of these. */
async function costNow($: EngineInterface): Promise<number | null> {
  const u = await $.session.usage().catch(() => null)
  return u?.cost?.usd ?? null
}

const statusColor = (c: AgentCard) => (c.status === 'failed' ? C.warn : c.status === 'done' ? C.good : C.agent)
/**
 * A clock for one surface: it ticks by itself where the surface runs client modules, and is a
 * fixed reading where it does not. A start time of 0 is unknown: no clock, not decades.
 */
const clockOf = (els: ReturnType<EngineInterface['ui']['resolve']>, now: number) => (key: string, since: number, endAt: number | null, color: string) =>
  since <= 0 ? (
    <els.Text color={color}>—</els.Text>
  ) : 'Client' in els ? (
    <els.Client key={key} module="./elapsed.tsx" props={{ since, now, endAt, color }} />
  ) : (
    <els.Text color={color}>{fmtTimer((endAt ?? now) - since)}</els.Text>
  )

const toneColor = (tone: 'good' | 'bad' | 'plain') => (tone === 'good' ? C.good : tone === 'bad' ? C.warn : C.text)
/** The last reply's headline with its tick or cross in front. */
const headlineText = (r: Receipt) => `${r.reason === 'answer' ? '✓' : '✗'} ${receiptHeadline(r).text}`
const glyph = (c: AgentCard) => (c.status === 'running' ? '◐' : c.status === 'done' ? '✓' : c.status === 'failed' ? '✗' : '■')

// ---------------------------------------------------------------- hooks

export const register: Register = (on, options) => {
  const cfg = parseConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spotter',
      description: 'Spotter, the live agent dashboard: open, close or reset',
      argumentHint: '[open|close|reset]',
    })
    // The bar above the prompt draws what Claude reports here. Listed from the start, not behind
    // tool search: a tool Claude has to look up first is one it never reaches for.
    await $.tool
      .register({
        name: 'progress',
        description:
          'Shows the person a progress bar above the prompt. Use it when a job has 3 or more distinct steps: ' +
          'once at the start with `title` (2 to 4 words) and `total` (the number of steps), again with `done` each time a step is finished, ' +
          'and once with `finished: true` when the job is over. `step` names the step now under way. Fields left out keep their value. ' +
          'Skip it for short jobs. A helper agent with 3 or more steps of its own may call it the same way: its count shows on its own card. ' +
          'It costs a round trip when sent alone, so send it beside other tool calls: the start beside the first step\'s first call, ' +
          'a finished step beside the next step\'s first call, and `finished: true` beside the last step\'s last call.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short name of the job, 2 to 4 words.' },
            total: { type: 'integer', minimum: 0, description: 'How many steps the job has.' },
            done: { type: 'integer', minimum: 0, description: 'How many steps are finished.' },
            step: { type: 'string', description: 'The step now under way, 2 to 5 words.' },
            finished: { type: 'boolean', description: 'True once the whole job is over.' },
          },
        },
        isDeferred: false,
      })
      .catch(() => undefined)
    // The terminal gets the strip above the prompt; its side panel opens on /spotter only.
    // A new chat in the app often has nothing attached yet: opening then printed a no-surface
    // line in the chat, so the panel waits for the app to attach (session.attach below).
    if (cfg.openOnStart && e.surface !== 'terminal' && (await $.session.surfaces()).length > 0) void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    if (cfg.openOnStart && e.surface !== 'terminal') void openPane($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await resetAll($)
    }
    return next(e)
  })

  on('command.run', { command: 'spotter' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0] || 'open'
    if (verb === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Spotter closed.' }
    }
    if (verb === 'reset') {
      await resetAll($)
      return { text: 'Spotter reset.' }
    }
    const opened = await openPane($)
    if (!opened.isPlaced) return { text: `Spotter is not shown yet: ${opened.reason}` }
    return { text: 'Spotter opened. Click an agent for its details, or focus the pane with ctrl+x tab: 1-6 open agents.' }
  })

  on('turn.start', async ($, e, next) => {
    const [now, cost] = await Promise.all([$.clock.now(), costNow($)])
    await update($, turn, () => ({ ...DEFAULT_TURN, startedAt: now, costAtStart: cost }))
    await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: true }))
    // A finished bar stays up until the next turn starts.
    if ((await getPlan($))?.isFinished) await update($, plan, () => null)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const result = yield* next(e)
      // Each request renews the prompt cache: the session box counts down from here.
      const now = await $.clock.now()
      await update($, main, m => {
        const x = normalize(DEFAULT_MAIN, m)
        return { ...x, lastRequestAt: now, cacheTtlMs: cacheTtlOf(result.usage, x.cacheTtlMs) }
      })
      return result
    }
    const result = yield* next(e)
    await updateCard($, e.agentId, c => applyStep(c, { model: e.model, usage: result.usage, stopReason: result.stopReason }))
    return result
  })

  // The bar's own tool only draws: allowed without asking.
  on('tool.check', async (_$, e, next) => (String(e.tool) === PROGRESS_TOOL ? { decision: 'allow' } : next(e)))

  on('tool.call', async ($, e, next) => {
    // The bar's own tool: answered here, and kept off the cards.
    if (String(e.tool) === PROGRESS_TOOL) {
      // A helper agent's call counts on its own card; the bar is the main session's.
      if (e.agentId) {
        await updateCard($, e.agentId, c => mergeAgentSteps(c, e))
        return { result: 'ok' }
      }
      const p = mergePlan(await getPlan($), e, await $.clock.now())
      await update($, plan, () => p)
      return { result: `ok: ${planLabel(p)}` }
    }
    const ran = await next(e)
    // Starting an agent and its hand-back are not work to count.
    if (String(e.tool) === 'SubagentHandback' || e.tool === 'Agent') return ran
    const didRun = ran.deny === undefined
    const hasFailed = didRun && ran.isError === true
    const isEdit = !hasFailed && didRun && EDIT_TOOLS.has(e.tool)
    if (isEdit || (hasFailed && !e.agentId)) {
      await update($, turn, t => afterCall(normalize(DEFAULT_TURN, t), { inSubagent: Boolean(e.agentId), hasFailed, isEdit }))
    }
    if (e.agentId) {
      const text = shorten(describeInput(e.tool, e), 80)
      await updateCard($, e.agentId, c => noteTool(c, { text, isError: hasFailed || ran.deny !== undefined }))
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    const card: AgentCard = {
      ...normalizeCard({}),
      id: started.agentId,
      type: e.name ?? e.subagentType,
      model: started.model,
      description: e.description,
      spawnedAt: await $.clock.now(),
    }
    await update($, agents, list => [...listOf<unknown>(list).map(normalizeCard), card].slice(-24))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const id = e.agentId
    if (!id) {
      const [t, cards, cost, last] = await Promise.all([getTurn($), getCards($), costNow($), getReceipt($)])
      const r = receiptOf(t, {
        durationMs: e.durationMs,
        agentsSince: cards.filter(c => c.spawnedAt >= t.startedAt).length,
        costNow: cost,
        reason: e.reason,
        streakBefore: last?.streak ?? 0,
      })
      await update($, receipt, () => r)
      await update($, main, m => ({ ...normalize(DEFAULT_MAIN, m), isRunning: false }))
      return done
    }
    const now = await $.clock.now()
    const status = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
    // An agent that finished has finished its own plan, whatever count it last reported.
    await updateCard($, id, c => ({ ...c, status, endedAt: now, answer: e.answer.trim().slice(0, 3000), stepDone: status === 'done' && c.stepTotal ? c.stepTotal : c.stepDone }))
    return done
  })

  // ---------------------------------------------------------------- drawing

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const hasClient = 'Client' in els
    const [m, cards, t, r, v, now, u] = await Promise.all([getMain($), getCards($), getTurn($), getReceipt($), getView($), $.clock.now(), $.session.usage().catch(() => null)])
    const W = Math.max(32, e.props.bodyColumns)
    // Off the terminal the font is not fixed-pitch: ━ ▰ draw about two cells wide, so rows
    // built from them hold half as many and clip at their box.
    const wide = (cells: number) => (e.surface === 'terminal' ? cells : Math.floor(cells / 2))
    const viewed = e.props.view?.agentId ?? null
    const running = cards.filter(c => c.status === 'running')
    const hasReceipt = m.isRunning || r !== null
    // The session box: how full the context is, the plan's limits, and how long the cache has left.
    const pct = u?.context.percent
    const limits = u?.rateLimits ?? []
    const hasSession = pct !== undefined || limits.length > 0 || m.lastRequestAt > 0 || hasReceipt

    const clock = clockOf(els, now)

    // ---- agents: full rows in the desktop app, one line each in the terminal and when seated inline
    const statusWords = (c: AgentCard) => (c.status === 'done' ? 'finished' : c.status)
    const expandOnPress = (id: string) => () =>
      update($, view, x => ({ ...normalize(DEFAULT_VIEW, x), expanded: normalize(DEFAULT_VIEW, x).expanded === id ? null : id }))

    // Each agent's Pal, picked by its job: a small drawing where the surface draws them (it hops
    // while the agent works), an emoji in the terminal. Only a drawing big enough to show it grows.
    const spriteOf = (c: AgentCard, scale: number, grows = false) => {
      const k = palOf(c)
      return e.surface !== 'terminal' && 'Svg' in els ? (
        <els.Svg
          source={palSvg(k, palLook(c), scale, c.status === 'running', cfg.motion, !grows)}
          alt={`${palWords(k, palLook(c)).name}${palLook(c).isDown ? '' : `, ${palLook(c).stars} of 4 stars`}`}
          width={Math.ceil(PAL_GRID.w * scale)}
          height={Math.ceil(PAL_GRID.h * scale)}
        />
      ) : (
        <Text>{palEmoji(k, palLook(c))}</Text>
      )
    }
    const palLine = (c: AgentCard, withJob: boolean) => {
      const look = palLook(c)
      const words = palWords(palOf(c), look)
      return (
        <Text wrap="truncate">
          <Text color={look.isDown ? C.warn : PALS[palOf(c)].color} bold>
            {words.name}
          </Text>
          {withJob && words.job ? <Text dimColor>{` · ${words.job}`}</Text> : null}
          {!look.isDown && look.stars > 0 ? <Text color={C.amber}>{` ${'★'.repeat(look.stars)}`}</Text> : null}
        </Text>
      )
    }
    // The agent's own plan as a small gauge when it reports one; how far it has gone otherwise.
    const stepsRow = (c: AgentCard, w: number) => {
      const ratio = agentRatio(c)
      if (ratio === null) {
        return (
          <Text dimColor wrap="truncate">
            {c.steps > 0 ? `${plural(c.steps, 'step')} so far · memory ${kTokens(c.ctx)}` : 'starting…'}
          </Text>
        )
      }
      const cells = wide(Math.max(4, Math.min(10, w - 12)))
      const full = Math.round(cells * ratio)
      return (
        <Text wrap="truncate">
          <Text color={PALS[palOf(c)].color}>{'▰'.repeat(full)}</Text>
          <Text color={C.faint}>{'▱'.repeat(cells - full)}</Text>
          <Text bold>{` step ${agentSteps(c)}`}</Text>
          {c.stepNote ? <Text dimColor>{` · ${c.stepNote}`}</Text> : null}
        </Text>
      )
    }

    const isInline = e.props.placement === 'inline'
    const agentsPanel = (w: number) => {
      const header = (
        <Box justifyContent="space-between" width={w}>
          <Text bold>{`agents · ${running.length} running · ${cards.length} total`}</Text>
          {w >= 62 ? (
            <Text color={C.faint}>{e.surface === 'terminal' ? `1-${Math.min(cards.length, 6)} for details` : 'click a name for details'}</Text>
          ) : null}
        </Box>
      )
      // Where the Pals are drawn (not the terminal) each agent gets a full-width row of its own:
      // a Pal big enough to see it grow, the whole name, its job and its steps.
      if (!isInline && e.surface !== 'terminal' && 'Svg' in els) {
        const shown = cards.slice(-6)
        return (
          <Box flexDirection="column" width={w}>
            {header}
            {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
            {shown.map((c, i) => {
              const isViewed = viewed === c.id
              // The whole name, on two lines when one cannot hold it. The app's font is narrower
              // than a terminal cell, so a line holds about a third more letters than cells.
              const room = Math.floor((w - 14) * 1.3)
              const [first, rest] = titleLines(cardTitle(c), room - 4, room)
              return (
                <Box
                  borderStyle={isViewed ? 'double' : 'bold'}
                  borderColor={c.lastStop === 'max_tokens' || palLook(c).isDown ? C.warn : PALS[palOf(c)].color}
                  width={w}
                  paddingX={1}
                  columnGap={2}
                  alignItems="center"
                >
                  <Box flexShrink={0}>{spriteOf(c, w >= 40 ? 1.6 : 1, true)}</Box>
                  {/* minWidth 0 keeps every line inside the card: the left words shorten so the clock and model stay in. */}
                  <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
                    <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={first} onPress={expandOnPress(c.id)} />
                    {rest ? <Text wrap="truncate">{rest}</Text> : null}
                    <Box justifyContent="space-between">
                      <Box flexShrink={1} minWidth={0}>{palLine(c, true)}</Box>
                      <Box flexShrink={0}>
                        <Text color={c.lastStop === 'max_tokens' ? C.warn : statusColor(c)}>{`${glyph(c)} `}</Text>
                        {clock(`stack-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}
                      </Box>
                    </Box>
                    {/* Its steps on the left, the model it runs on at the right. */}
                    <Box justifyContent="space-between">
                      <Box flexShrink={1} minWidth={0}>{stepsRow({ ...c, stepNote: '' }, w - 14)}</Box>
                      {c.model ? (
                        <Box flexShrink={0} marginLeft={1}>
                          <Text color={C.dim}>{prettyModel(c.model)}</Text>
                        </Box>
                      ) : null}
                    </Box>
                    {c.stepNote && agentRatio(c) !== null ? (
                      <Text dimColor wrap="truncate">
                        {c.stepNote}
                      </Text>
                    ) : null}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      }
      const shown = cards.slice(-6)
      const nameW = Math.max(12, Math.min(30, w - 40))
      // Beside the name: the Pal, and from 50 columns the agent's own step count.
      const stepsW = w >= 50 ? 6 : 0
      const barW = Math.max(4, w - nameW - 13 - stepsW)
      const geo = lanes(shown, now, wide(barW))
      return (
        <Box flexDirection="column" width={w}>
          {header}
          {cards.length > shown.length ? <Text color={C.faint}>{`+${cards.length - shown.length} earlier`}</Text> : null}
          {shown.map((c, i) => {
            const gm = geo[i]
            const isViewed = viewed === c.id
            return (
              <Box width={w}>
                <Text color={statusColor(c)} bold={isViewed}>{`${isViewed ? '▶' : glyph(c)} `}</Text>
                <Box flexShrink={0} marginRight={1}>
                  {spriteOf(c, 0.5)}
                </Box>
                <Box width={nameW}>
                  <Button key={`card-${c.id}`} plain hotkey={String(i + 1)} label={shorten(cardTitle(c), nameW - 3)} onPress={expandOnPress(c.id)} />
                </Box>
                <Box flexGrow={1} overflow="hidden">
                  <Text color={C.faint}>{' ' + '·'.repeat(gm?.before ?? 0)}</Text>
                  <Text color={statusColor(c)}>{'━'.repeat(gm?.bar ?? 1)}</Text>
                  <Text color={C.faint}>{'·'.repeat(gm?.after ?? 0) + ' '}</Text>
                </Box>
                {stepsW > 0 ? (
                  <Box width={stepsW} flexShrink={0}>
                    <Text color={PALS[palOf(c)].color} wrap="truncate">
                      {agentSteps(c) ?? ''}
                    </Text>
                  </Box>
                ) : null}
                <Box flexShrink={0}>{clock(`lane-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
              </Box>
            )
          })}
        </Box>
      )
    }

    const expandedCard = cards.find(c => c.id === v.expanded)
    const expandedPanel = (w: number) =>
      expandedCard ? (
        <Box flexDirection="column" borderStyle="single" borderColor={C.agent} paddingX={1} width={w}>
          <Box columnGap={1} alignItems="center">
            <Box flexShrink={0}>{spriteOf(expandedCard, 0.75)}</Box>
            {palLine(expandedCard, true)}
          </Box>
          <Text bold wrap="wrap">
            {expandedCard.description || expandedCard.type}
          </Text>
          <Text dimColor wrap="truncate">
            {`${expandedCard.type} agent · ${prettyModel(expandedCard.model)} · ${statusWords(expandedCard)}${expandedCard.spawnedAt > 0 ? ` ${expandedCard.endedAt ? 'in' : 'for'} ${fmtDuration((expandedCard.endedAt ?? now) - expandedCard.spawnedAt)}` : ''} · ${plural(expandedCard.steps, 'step')} so far`}
          </Text>
          {agentRatio(expandedCard) !== null ? stepsRow(expandedCard, w - 4) : null}
          <Text bold>{expandedCard.tools.length >= 12 ? 'What it did (latest 12):' : 'What it did:'}</Text>
          {expandedCard.tools.length === 0 ? <Text color={C.faint}>nothing yet</Text> : null}
          {expandedCard.tools.map(n => (
            <Text color={n.isError ? C.warn : C.text} wrap="wrap">
              {`${n.isError ? '✗ failed ·' : '·'} ${n.text}`}
            </Text>
          ))}
          <Text bold>What it reported:</Text>
          {expandedCard.answer ? null : <Text color={C.faint}>{expandedCard.status === 'running' ? 'still working' : 'nothing'}</Text>}
          {expandedCard.answer
            .split('\n')
            .filter(l => l.trim())
            .slice(0, 60)
            .map(l => (
              <Text dimColor wrap="wrap">
                {l.trimEnd()}
              </Text>
            ))}
          {expandedCard.answer.length >= 3000 ? <Text color={C.faint}>(cut at 3,000 characters)</Text> : null}
          <Text color={C.faint}>{e.surface === 'terminal' ? 'press its number again to close' : 'click its name again to close'}</Text>
        </Box>
      ) : null

    const row = (label: string, value: RenderChildren) => (
      <Box>
        <Box width={e.surface === 'terminal' ? 14 : 10} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        {/* minWidth 0 lets the value narrow to the box, so a long one wraps instead of spilling past the border. */}
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {value}
        </Box>
      </Box>
    )
    // The reply under way, or the last one: only the counts that are not zero.
    const helpersNow = t.startedAt > 0 ? cards.filter(c => c.spawnedAt >= t.startedAt).length : 0
    const counts = (helpers: number, edits: number, errors: number) => {
      const quiet = [helpers > 0 ? plural(helpers, 'helper') : '', edits > 0 ? plural(edits, 'file change') : ''].filter(Boolean).join(' · ')
      if (!quiet && errors === 0) return null
      return row(
        '',
        <Text wrap="truncate">
          <Text dimColor>{quiet}</Text>
          {errors > 0 ? <Text color={C.warn}>{`${quiet ? ' · ' : ''}${plural(errors, 'error')}`}</Text> : null}
        </Text>,
      )
    }
    // One box at the top: how full the context is, the plan's limits, how long the cache has
    // left, and the reply under way or the last one.
    const sessionPanel = (w: number) => {
      const cells = wide(10)
      const full = Math.round((cells * Math.min(100, pct ?? 0)) / 100)
      const left = u?.context.tokens !== undefined ? Math.max(0, u.context.window - u.context.tokens) : null
      const cache = cacheLabel(m.lastRequestAt + m.cacheTtlMs - now)
      const cacheColor = { plain: C.dim, soon: C.amber, cold: C.warn }
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={C.dim} paddingX={1} width={w}>
          {pct !== undefined
            ? row(
                'Context',
                <Text wrap="truncate">
                  <Text color={pct >= 70 ? C.warn : pct >= 40 ? C.amber : C.good}>{'▰'.repeat(full)}</Text>
                  <Text color={C.faint}>{'▱'.repeat(cells - full)}</Text>
                  <Text bold>{` ${Math.round(pct)}% used`}</Text>
                </Text>,
              )
            : null}
          {pct !== undefined && left !== null && u ? row('', <Text dimColor wrap="truncate">{`${kTokens(left)} left of ${kTokens(u.context.window)}`}</Text>) : null}
          {limits.map(l =>
            row(
              limitLabel(l.kind),
              <Text color={l.percentUsed >= 80 ? C.warn : l.percentUsed >= 50 ? C.amber : C.text} wrap="truncate">{`${Math.round(l.percentUsed)}% used`}</Text>,
            ),
          )}
          {m.lastRequestAt > 0
            ? row(
                'Cache',
                hasClient ? (
                  <els.Client key="cache-clock" module="./cache.tsx" props={{ expiresAt: m.lastRequestAt + m.cacheTtlMs, now, ...cacheColor }} />
                ) : (
                  <Text color={cacheColor[cache.tone]} wrap="wrap">
                    {cache.text}
                  </Text>
                ),
              )
            : null}
          {m.isRunning
            ? row(
                'This reply',
                <Box>
                  <Text color={C.main}>{'◐ working · '}</Text>
                  <Box flexShrink={0}>{clock('turn-clock', t.startedAt, null, C.main)}</Box>
                </Box>,
              )
            : r
              ? row('Last reply', <Text wrap="truncate">{`${fmtDuration(r.durationMs)}${r.costDelta !== null ? ` · ${fmtUsd(r.costDelta)}` : ''}`}</Text>)
              : null}
          {m.isRunning ? counts(helpersNow, t.edits, t.errors) : r ? counts(r.agents, r.edits, r.errors) : null}
          {!m.isRunning && r ? (
            <Text color={toneColor(receiptHeadline(r).tone)} bold wrap="wrap">
              {headlineText(r)}
            </Text>
          ) : null}
          {!m.isRunning && r && r.streak >= 2 ? <Text color={C.amber}>{`🔥 ${r.streak} clean replies in a row`}</Text> : null}
        </Box>
      )
    }

    // Seated inline above the prompt the pane has 8 rows: the agents' lines alone fill them.
    if (isInline) {
      return (
        <Box flexDirection="column" width={W}>
          {cards.length > 0 ? agentsPanel(W) : <Text color={C.faint}>No helpers yet.</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={W}>
        {hasSession ? sessionPanel(W) : null}
        {cards.length > 0 ? (
          agentsPanel(W)
        ) : (
          <Text color={C.faint} wrap="wrap">
            No helpers yet. A Pal hatches here when Claude sends one out.
          </Text>
        )}
        {expandedPanel(W)}
      </Box>
    )
  })

  // Above the prompt: the progress bar from the plan Claude reported, and in the terminal the
  // strip that stands in for the side panel: a line per helper while any runs, else the last reply.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const isTerminal = e.surface === 'terminal'
    const [p, cards, m, r, now] = await Promise.all([getPlan($), getCards($), getMain($), getReceipt($), $.clock.now()])
    const running = cards.filter(c => c.status === 'running')
    // While any helper runs, every helper of that batch keeps its line, the finished ones ticked.
    const since = Math.min(...running.map(c => c.spawnedAt))
    const batch = isTerminal && running.length > 0 ? cards.filter(c => c.status === 'running' || c.spawnedAt >= since) : []
    const head = isTerminal && batch.length === 0 && !m.isRunning && r ? receiptHeadline(r) : null
    if (!p && batch.length === 0 && !head) return next(e)
    // Another mod's band (the radio, say) keeps its row under this one.
    const beneath = await next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const cols = e.props.bodyColumns || 80

    const helperLine = (c: AgentCard) => {
      const k = palOf(c)
      const look = palLook(c)
      const ratio = agentRatio(c)
      const full = Math.round(6 * (ratio ?? 0))
      return (
        <Box width={cols}>
          <Text color={statusColor(c)}>{`${glyph(c)} `}</Text>
          {/* The Pal and its stars sit in fixed slots, so the names line up as the Pals grow. */}
          <Box width={5} flexShrink={0}>
            <Text>{palEmoji(k, look)}</Text>
          </Box>
          <Box width={5} flexShrink={0}>
            <Text color={C.amber}>{look.isDown ? '' : '★'.repeat(look.stars)}</Text>
          </Box>
          <Box width={Math.max(12, Math.min(44, cols - 48))} flexShrink={0}>
            <Text wrap="truncate">{cardTitle(c)}</Text>
          </Box>
          <Box flexGrow={1} overflow="hidden">
            {ratio === null ? (
              <Text dimColor wrap="truncate">{c.steps > 0 ? ` ${plural(c.steps, 'step')} so far` : ' starting…'}</Text>
            ) : (
              <Text wrap="truncate">
                <Text color={PALS[k].color}>{` ${'▰'.repeat(full)}`}</Text>
                <Text color={C.faint}>{'▱'.repeat(6 - full)}</Text>
                <Text bold>{` ${agentSteps(c)}`}</Text>
                {c.stepNote && cols >= 80 ? <Text dimColor>{` · ${c.stepNote}`}</Text> : null}
              </Text>
            )}
          </Box>
          {c.model && cols >= 90 ? (
            <Box width={12} flexShrink={0}>
              <Text color={C.dim} wrap="truncate">
                {prettyModel(c.model)}
              </Text>
            </Box>
          ) : null}
          <Box flexShrink={0}>{clockOf(els, now)(`strip-clock-${c.id}`, c.spawnedAt, c.endedAt, C.dim)}</Box>
        </Box>
      )
    }
    const shown = batch.slice(-5)
    const strip = (
      <Box flexDirection="column">
        {batch.length > shown.length ? <Text color={C.faint}>{`+${batch.length - shown.length} more helpers · /spotter for all`}</Text> : null}
        {shown.map(helperLine)}
        {head && r ? (
          <Text wrap="truncate">
            <Text color={toneColor(head.tone)}>{headlineText(r)}</Text>
            <Text dimColor>
              {`${head.text.includes(fmtDuration(r.durationMs)) ? '' : ` · ${fmtDuration(r.durationMs)}`}${r.costDelta !== null ? ` · ${fmtUsd(r.costDelta)}` : ''}`}
            </Text>
            {r.streak >= 2 ? <Text color={C.amber}>{` · 🔥 ${r.streak} in a row`}</Text> : null}
          </Text>
        ) : null}
      </Box>
    )
    if (!p) {
      return (
        <Box flexDirection="column">
          {strip}
          {beneath}
        </Box>
      )
    }

    const color = p.isFinished ? DONE : ACCENT
    const percent = `${Math.round(planRatio(p) * 100)}%`
    const crew = cards.length > 0 ? <Button key="bar-agents" plain label={`🐾×${cards.length}`} onPress={() => void openPane($).catch(() => undefined)} /> : null
    const barPal = palEmoji(palOf({ type: '', description: p.title, model: '' }), planLook(p))
    const dismiss = <Button key="bar-dismiss" plain label="✕" onPress={() => update($, plan, () => null)} />

    // The terminal's table carries an Svg that draws nothing, so the surface decides, not the table.
    if (!isTerminal && 'Svg' in els) {
      // About 8 px to the column; the rest of the row is the two buttons and their gaps.
      const width = Math.max(180, Math.min(1600, cols * 8 - 96))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <els.Svg source={barSvg(p, width, e.props.isWorking)} alt={`${p.title}: ${planLabel(p)}, ${percent}`} width={width} height={BAR_HEIGHT} />
            {crew}
            {dismiss}
          </Box>
          {beneath}
        </Box>
      )
    }

    const titleW = Math.max(8, Math.min(30, p.title.length + 2, Math.floor(cols / 3)))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={color}>● </Text>
            <Text wrap="truncate">{p.title}</Text>
          </Box>
          {cols >= 90 ? (
            <Text color={p.isFinished ? DONE : undefined} dimColor={!p.isFinished} wrap="truncate">
              {shorten(planHype(p), 24)}
            </Text>
          ) : null}
          <Text color={color}>{planBar(p, Math.max(6, Math.min(40, cols - titleW - (cols >= 90 ? 64 : 38))))}</Text>
          <Text bold>{planLabel(p)}</Text>
          <Text dimColor>{percent}</Text>
          <Text>{barPal}</Text>
          {crew}
          {dismiss}
        </Box>
        {strip}
        {beneath}
      </Box>
    )
  })
}
