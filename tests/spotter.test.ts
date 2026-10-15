import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_TURN,
  afterCall,
  agentSteps,
  applyStep,
  cacheLabel,
  cacheTtlOf,
  describeInput,
  isLucky,
  lanes,
  limitLabel,
  mergeAgentSteps,
  mergePlan,
  normalizeCard,
  palEmoji,
  palLook,
  palOf,
  palWords,
  parseConfig,
  planBar,
  planHype,
  planLabel,
  planRatio,
  prettyModel,
  receiptHeadline,
  receiptOf,
  redact,
  titleLines,
} from '../hooks/core'

// ---------------------------------------------------------------- pure behaviour

test('redaction masks credentials before anything is stored', () => {
  expect(redact('curl -H "Authorization: Bearer abc.def.ghi123" x')).not.toContain('abc.def')
  expect(redact('export OPENAI_API_KEY=sk-proj-1234567890abcdef')).not.toContain('1234567890')
  expect(redact('gh auth --token ghp_abcdefghijklmnop')).not.toContain('abcdefghijklmnop')
  expect(redact('psql postgres://bob:hunter2@db/x')).not.toContain('hunter2')
  expect(redact('password=hunter2 ls')).not.toContain('hunter2')
  expect(redact('ls -la src/')).toBe('ls -la src/')
  expect(describeInput('Read', { file_path: 'C:\\Users\\me\\proj\\src\\main.ts' })).toBe('Read file: src/main.ts')
})

test('edits count from every loop; errors only from the main loop', () => {
  expect(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: false, isEdit: true }).edits).toBe(1)
  expect(afterCall(DEFAULT_TURN, { inSubagent: true, hasFailed: true, isEdit: false }).errors).toBe(0)
  expect(afterCall(DEFAULT_TURN, { inSubagent: false, hasFailed: true, isEdit: false })).toEqual({ ...DEFAULT_TURN, errors: 1 })
})

test("a card's context is its latest step's whole input", () => {
  let c = normalizeCard({ id: 'x' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 2_000 }, stopReason: 'tool_use' })
  c = applyStep(c, { model: 'claude-sonnet-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 40_000 }, stopReason: 'max_tokens' })
  expect([c.ctx, c.steps, c.lastStop, c.model]).toEqual([40_005, 2, 'max_tokens', 'claude-sonnet-5-5'])
})

test('config is read leniently: bad values fall back to defaults', () => {
  expect(parseConfig({})).toEqual({ motion: true, openOnStart: true })
  expect(parseConfig({ motion: 'off', openOnStart: 'yes' })).toEqual({ motion: false, openOnStart: true })
  expect(parseConfig({ openOnStart: false }).openOnStart).toBe(false)
})

test('layout math and labels: lanes share one axis, models and titles read short', () => {
  const cards = [
    { ...normalizeCard({}), id: 'a', spawnedAt: 1000, endedAt: 1050 },
    { ...normalizeCard({}), id: 'b', spawnedAt: 1050, endedAt: null },
  ]
  const [a, b] = lanes(cards, 1100, 20)
  expect(a).toEqual({ id: 'a', before: 0, bar: 10, after: 10 })
  expect(b?.before).toBe(10)
  expect((b?.before ?? 0) + (b?.bar ?? 0) + (b?.after ?? 0)).toBe(20)
  expect(normalizeCard({ id: 'a', status: 'done' }).tools).toEqual([])
  expect(prettyModel('claude-opus-5-5[1m]')).toBe('Opus 5.5 1M')
  expect(prettyModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5')
  expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
  expect(prettyModel('claude-3-opus-20240229')).toBe('Opus 3')
  expect(prettyModel('z-ai/glm-5.3-flash-with-a-long-name')).toBe('z-ai/glm-5.3-flash-wi…')
  expect(prettyModel('')).toBe('—')
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 5 }, { durationMs: 1, agentsSince: 0, costNow: 5, reason: 'answer' }).costDelta).toBe(null)
  expect(titleLines('Write tinyqueue test suite', 13, 16)).toEqual(['Write', 'tinyqueue test…'])
  expect(titleLines('Short', 13, 16)).toEqual(['Short', ''])
  expect(titleLines('read:projects-mods-maint-usage', 23, 27)).toEqual(['read:projects-mods-', 'maint-usage'])
  expect(receiptOf({ ...DEFAULT_TURN, costAtStart: 1, edits: 2 }, { durationMs: 1000, agentsSince: 3, costNow: 1.5, reason: 'answer' }).costDelta).toBe(0.5)
})

// ---------------------------------------------------------------- drawing

const engine = (on: On, now = 0) => {
  mock.clock(on, { now })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const pane = (bodyColumns: number) => ({
  plugin: 'spotter',
  component: 'Pane' as const,
  requestId: 'spotter',
  props: {
    title: 'Spotter',
    isFocused: true,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 70 },
    view: {},
  },
})

let spawnN = 0
const spawn = (subagentType: string, description: string) => ({
  prompt: description,
  description,
  subagentType,
  tool_use_id: `tu${++spawnN}`,
  provider: { plugin: 'engine', tier: 'core' as const },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
})

test('a fresh session draws on every surface and width with nothing to show', async ($, on) => {
  engine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const ui = await $.ui.mount({ ...pane(cols), surface })
      expect(await ui.find({ text: /No helpers yet/ })).toBeDefined()
      expect(await ui.find({ text: /agents ·/ })).toBeUndefined()
      await ui.unmount()
    }
  }
})

test('every helper gets a row, whatever its type is called', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-fable-5-1', agentId: 'adv1' }))
  await $.turn.start({ text: 'review it', turnId: 'A1' })
  await $.agent.spawn(spawn('advisor:advisor', 'final review'))
  for (const placement of ['dock', 'inline'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement }, surface: 'terminal' })
    expect(await ui.find({ text: /final review/ })).toBeDefined()
    expect(await ui.find({ text: /No helpers yet/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('seated inline above the prompt, the pane is the agents alone, one line each', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `m${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'M1' })
  for (const d of ['one', 'two', 'three', 'four', 'five', 'six', 'seven']) await $.agent.spawn(spawn('general-purpose', `task ${d}`))
  for (const surface of ['terminal', 'vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(80), props: { ...pane(80).props, placement: 'inline' as const }, surface })
    expect(await ui.find({ text: /7 total/ })).toBeDefined()
    expect(await ui.find({ text: /━/ })).toBeDefined() // lines, even where the docked pane draws full rows
    expect(await ui.find({ text: /^\+1 earlier$/ })).toBeDefined() // the latest six
    expect(await ui.find({ text: /^This reply$/ })).toBeUndefined() // no session box: it has 8 rows
    await ui.unmount()
  }
})

test('/clear starts the pane fresh', async ($, on) => {
  engine(on)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'c1' }))
  await $.turn.start({ text: 'go', turnId: 'C1' })
  await $.agent.spawn(spawn('Explore', 'look around'))
  await $.session.end({ reason: 'clear', sessionId: 's' } as never)
  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /look around/ })).toBeUndefined()
  await ui.unmount()
})

test('in the terminal each subagent is one line on a shared time axis; a line expands on its hotkey', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `ag${++n}` }))
  await $.turn.start({ text: 'fan out', turnId: 'T1' })
  await $.agent.spawn(spawn('general-purpose', 'Write the parser tests'))
  await $.agent.spawn(spawn('Explore', 'Map the call sites'))

  const ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await ui.find({ text: /2 total/ })).toBeDefined()
  expect(await ui.find({ text: /━/ })).toBeDefined()
  await ui.press({ key: 'card-ag1' })
  expect(await ui.find({ text: /^Write the parser tests$/ })).toBeDefined() // the expanded panel, full title
  expect(await ui.find({ text: /Sonnet 5\.5/ })).toBeDefined() // and the model it runs on
  await ui.unmount()

  await $.agent.spawn(spawn('general-purpose', 'Implement the parser'))
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  const lanesUi = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  expect(await lanesUi.find({ text: /4 total/ })).toBeDefined()
  expect(await lanesUi.find({ text: /━/ })).toBeDefined()
  await lanesUi.unmount()

  // The desktop app draws the Pals, so each agent gets a full row: whole name, no lanes.
  const stackUi = await $.ui.mount({ ...pane(48), surface: 'desktop' })
  expect(await stackUi.find({ text: /4 total/ })).toBeDefined()
  expect(await stackUi.find({ text: /━/ })).toBeUndefined()
  expect(await stackUi.find({ text: /Review the parser/ })).toBeDefined()
  expect(await stackUi.find({ text: /^Egg$/ })).toBeDefined() // nothing done yet: still eggs
  await stackUi.unmount()
})

test('the terminal panel is one line per agent at any width', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `w${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'W1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  for (const cols of [40, 82, 120]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'terminal' })
    expect(await ui.find({ text: /━/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' } as never)).toBeUndefined()
    await ui.unmount()
  }
})

test('a side panel in the desktop app gets one row per agent with a Pal sized to fit', async ($, on) => {
  engine(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `n${++n}` }))
  await $.turn.start({ text: 'go', turnId: 'N1' })
  for (const d of ['alpha', 'beta', 'gamma']) await $.agent.spawn(spawn('Explore', `task ${d}`))
  for (const cols of [28, 36, 66]) {
    const ui = await $.ui.mount({ ...pane(cols), surface: 'desktop' })
    expect(await ui.find({ text: /━/ })).toBeUndefined() // one full row per agent, not lanes
    expect(await ui.find({ text: /task gamma/ })).toBeDefined()
    // The only drawings are the agents' Pals: big where there is room, smaller in a narrow pane.
    const svg = await ui.find({ type: 'Svg' } as never)
    expect(String(svg?.props.alt)).toBe('Egg, 0 of 4 stars')
    expect(Number(svg?.props.width)).toBe(cols >= 40 ? 64 : 40)
    await ui.unmount()
  }
})

test('in the desktop app a long helper name wraps to a second line instead of being cut', async ($, on) => {
  engine(on)
  const ids = ['long1', 'short1']
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: ids.shift() ?? 'x' }))
  await $.turn.start({ text: 'go', turnId: 'L1' })
  await $.agent.spawn(spawn('general-purpose', 'Implement the size option for the side panel'))
  const ui = await $.ui.mount({ ...pane(40), surface: 'desktop' })
  const name = await ui.find({ key: 'card-long1' } as never)
  expect(String(name?.props.label)).toBe('Implement the size option for')
  expect(await ui.find({ text: /^the side panel$/ })).toBeDefined()
  await ui.unmount()
  // A short name stays on one line.
  await $.agent.spawn(spawn('Explore', 'Map the mod folders'))
  const again = await $.ui.mount({ ...pane(40), surface: 'desktop' })
  expect(String((await again.find({ key: 'card-short1' } as never))?.props.label)).toBe('Map the mod folders')
  await again.unmount()
})

test("an agent's detail box says what it did and shows its whole report, in plain words", async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'd1' }))
  await $.turn.start({ text: 'go', turnId: 'D1' })
  await $.agent.spawn(spawn('Explore', 'Count the tests'))
  await $.turn.complete({ answer: 'There are 26 tests.\n\nAll four surfaces are covered.', durationMs: 10, isAborted: false, turnId: 'D1', agentId: 'd1', reason: 'answer' })
  const ui = await $.ui.mount({ ...pane(66), surface: 'desktop' })
  expect(await ui.find({ text: /click a name for details/ })).toBeDefined()
  await ui.press({ key: 'card-d1' })
  expect(await ui.find({ text: /^Explore agent · Haiku 4\.5 · finished/ })).toBeDefined()
  expect(await ui.find({ text: /^What it did:$/ })).toBeDefined()
  expect(await ui.find({ text: /^All four surfaces are covered\.$/ })).toBeDefined() // past the first line of the report
  await ui.unmount()
  expect(describeInput('Bash', { command: 'ls -la' })).toBe('Command: ls -la')
  expect(describeInput('mcp__chrome__open_url', { url: 'https://example.com' })).toBe('chrome: open url: https://example.com')
  expect(describeInput('Grep', { pattern: 'password=hunter2' })).not.toContain('hunter2')
})

// ---------------------------------------------------------------- the progress bar

test('the plan merges progress calls, clamps, and starts fresh on a new title or after finishing', () => {
  let p = mergePlan(null, { title: 'Launch kit', total: 4 })
  expect([p.title, p.total, p.done, planLabel(p)]).toEqual(['Launch kit', 4, 0, 'Steps 0/4'])
  p = mergePlan(p, { done: 9 }) // more done than planned: clamped
  expect([p.done, planRatio(p)]).toEqual([4, 1])
  p = mergePlan(p, { done: 2 })
  expect([p.title, planBar(p, 10)]).toEqual(['Launch kit', '█████░░░░░'])
  p = mergePlan(p, { finished: true })
  expect([p.isFinished, planLabel(p), planRatio(p)]).toEqual([true, 'Done', 1])
  const fresh = { title: 'Working', total: 0, done: 0, isFinished: false, step: '', startedAt: 0, endedAt: null }
  expect(mergePlan(p, { done: 1 })).toEqual({ ...fresh, done: 1 })
  expect(mergePlan(mergePlan(null, { title: 'A', total: 3, done: 2 }), { title: 'B', total: 5 }).done).toBe(0)
  expect(mergePlan(null, 'nonsense')).toEqual(fresh)
  expect(planLabel(mergePlan(null, {}))).toBe('Working')
})

test('the bar names the step under way, nudges when Claude names none, and times the finish', () => {
  let p = mergePlan(null, { title: 'Launch kit', total: 4 }, 1_000)
  expect(planHype(p)).toBe('Warming up')
  p = mergePlan(p, { done: 1, step: 'Writing the tests' }, 20_000)
  expect([planHype(p), p.startedAt]).toEqual(['Writing the tests', 1_000])
  p = mergePlan(p, { done: 2 }, 30_000)
  expect(planHype(p)).toBe('Writing the tests') // a step left out keeps its value
  expect(planHype({ ...p, step: '' })).toBe('Past halfway')
  expect(planHype({ ...p, step: '', done: 3 })).toBe('One step left')
  p = mergePlan(p, { finished: true }, 126_000)
  expect([planLabel(p), planHype(p)]).toEqual(['Done in 2m05s', 'Nailed it'])
})

test('each agent gets the Pal of the job it runs, and its own step count', () => {
  const of = (type: string, description = '', model = '') => palOf({ type, description, model })
  expect(of('Explore', 'Map the call sites')).toBe('vixy')
  expect(of('Plan', 'Design the rollout')).toBe('hoocrates')
  expect(of('release-verifier', 'anything')).toBe('depresso')
  expect(of('impeccable-asset-producer')).toBe('lifmunk')
  expect(of('desktop-app-engineer')).toBe('anubis')
  expect(of('statusline-setup')).toBe('foxparks')
  // A general helper is dressed by its task, not its type.
  expect(of('general-purpose', 'Review the parser')).toBe('depresso')
  expect(of('general-purpose', 'Implement the parser')).toBe('anubis')
  expect(of('general-purpose', 'Something vague', 'claude-haiku-5-5')).toBe('foxparks')
  // Nothing is left undressed: with no telling word, it is building.
  expect(of('general-purpose', 'Something vague')).toBe('anubis')
  expect(of('general-purpose', 'Light keyboard and setup overlay')).toBe('anubis')
  // The first telling word decides, not the order of the rules.
  expect(of('general-purpose', 'Add tests for the parser')).toBe('anubis')
  expect(of('general-purpose', 'Pull the data for five reports')).toBe('vixy')
  expect(of('general-purpose', 'Analyze recording 2')).toBe('depresso')
  expect(of('general-purpose', 'Remove the old spike')).toBe('foxparks')
  expect(of('general-purpose', 'Digest prompts group 3')).toBe('lifmunk')
  expect(of('general-purpose', 'ATTACK seat on the proposal')).toBe('depresso')
  expect(of('general-purpose', 'Survey free prior art')).toBe('vixy')
  expect(of('claude-code-guide')).toBe('vixy')
  expect(of('codebase-archaeologist')).toBe('vixy')

  let c = normalizeCard({ id: 'a' })
  expect(agentSteps(c)).toBe(null)
  c = mergeAgentSteps(c, { title: 'Audit', total: 5 })
  c = mergeAgentSteps(c, { done: 9, step: 'Reading the hooks' })
  expect([agentSteps(c), c.stepNote]).toEqual(['5/5', 'Reading the hooks'])
  expect(agentSteps(mergeAgentSteps(c, { done: 2 }))).toBe('2/5')
})

test('a Pal is an egg, grows with its agent, is Lucky for about one in twenty, and is knocked out on a failure', () => {
  const card = (over: object) => ({ ...normalizeCard({ id: 'sub1', status: 'running' }), ...over })
  // No plan of its own: it grows with the steps it has taken.
  expect([0, 1, 4, 5, 30].map(steps => palLook(card({ steps })).stars)).toEqual([0, 1, 1, 2, 2])
  // With a plan: an egg until a step is done, two stars from halfway, four only when it is done.
  expect([0, 1, 3, 6].map(stepDone => palLook(card({ steps: 9, stepTotal: 6, stepDone })).stars)).toEqual([0, 1, 2, 2])
  expect(palLook(card({ status: 'done' })).stars).toBe(4)
  expect(palWords('vixy', palLook(card({})))).toEqual({ name: 'Egg', job: 'incubating' })
  expect(palWords('vixy', palLook(card({ steps: 2 })))).toEqual({ name: 'Vixy', job: 'scouting' })

  // Lucky comes from the agent's id, so a redraw never changes it.
  const ids = Array.from({ length: 2000 }, (_, i) => `agent-${i}`)
  const lucky = ids.filter(isLucky).length
  expect(lucky).toBeGreaterThan(60)
  expect(lucky).toBeLessThan(140)
  expect(isLucky('sub5')).toBe(true)
  expect(palWords('lifmunk', palLook(card({ id: 'sub5', status: 'done' }))).name).toBe('Lucky Lifmunk')
  expect(palEmoji('lifmunk', palLook(card({ id: 'sub5', status: 'done' })))).toBe('🌿✨')
  // Lucky shows only at the end: until then it grows like any other.
  expect(palEmoji('lifmunk', palLook(card({ id: 'sub5' })))).toBe('🥚')
  expect(palLook(card({ id: 'sub5', steps: 9 }))).toEqual({ stars: 2, isLucky: false, isDown: false })

  for (const status of ['failed', 'stopped']) {
    const look = palLook(card({ status, steps: 3 }))
    expect(look.isDown).toBe(true)
    expect(palWords('foxparks', look)).toEqual({ name: '✗ Foxparks knocked out', job: '' })
    expect(palEmoji('foxparks', look)).toBe('💀')
  }
})

test('the last reply gets a headline made only from its own numbers, and a streak of clean ones', () => {
  const r = (o: Partial<Parameters<typeof receiptHeadline>[0]>) => ({ durationMs: 42_000, agents: 0, edits: 2, errors: 0, costDelta: null, reason: 'answer', streak: 1, ...o })
  expect(receiptHeadline(r({}))).toEqual({ text: 'Clean run: 2 file changes, zero errors', tone: 'good' })
  expect(receiptHeadline(r({ agents: 3 })).text).toBe('3 Pals went in. Zero errors came out.')
  expect(receiptHeadline(r({ agents: 1, edits: 0 })).text).toBe('1 Pal went in. Zero errors came out.') // never "0 file changes"
  expect(receiptHeadline(r({ errors: 1 }))).toEqual({ text: '1 stumble, still landed it', tone: 'plain' })
  expect(receiptHeadline(r({ errors: 4 })).tone).toBe('bad')
  expect(receiptHeadline(r({ edits: 0 })).text).toBe('Just talk: no files were changed')
  expect(receiptHeadline(r({ edits: 0, durationMs: 4_000 })).text).toBe('Answered in 4s. Blink and you missed it.')
  expect(receiptHeadline(r({ reason: 'aborted' }))).toEqual({ text: 'Stopped early after 42s', tone: 'bad' })
  const clean = { ...DEFAULT_TURN, edits: 1 }
  const o = { durationMs: 1, agentsSince: 0, costNow: null, reason: 'answer' }
  expect(receiptOf(clean, { ...o, streakBefore: 2 }).streak).toBe(3)
  expect(receiptOf({ ...clean, errors: 1 }, { ...o, streakBefore: 2 }).streak).toBe(0)
  expect(receiptOf(clean, { ...o, reason: 'aborted', streakBefore: 2 }).streak).toBe(0)
})

const band = (bodyColumns: number) => ({
  plugin: 'spotter',
  component: 'AbovePrompt' as const,
  requestId: 'band',
  viewport: { columns: bodyColumns, rows: 30 },
  props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
})

// What sits beneath the bar: the engine's own band, or another mod's.
const beneathBand = (on: On) => on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath the bar'] }))

test('the bar draws above the prompt from what Claude reports, and ✕ takes it down', async ($, on) => {
  engine(on)
  beneathBand(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const before = await $.ui.mount({ ...band(100), surface })
    expect(await before.find({ key: 'bar-dismiss' } as never)).toBeUndefined() // no plan: no bar
    await before.unmount()

    await $.tool.call({ tool: 'mcp__spotter__progress', title: 'Launch kit', total: 4, done: 1 } as never)
    const ui = await $.ui.mount({ ...band(100), surface })
    if (surface === 'terminal') {
      expect(await ui.find({ text: /^Launch kit$/ })).toBeDefined()
      expect(await ui.find({ text: /^Steps 1\/4$/ })).toBeDefined()
      expect(await ui.find({ text: /^25%$/ })).toBeDefined()
      expect(await ui.find({ text: /^beneath the bar$/ })).toBeDefined() // the row under it still draws
    } else {
      const svg = await ui.find({ type: 'Svg' } as never)
      expect(String(svg?.props.alt)).toBe('Launch kit: Steps 1/4, 25%')
      expect(String(svg?.props.source)).toContain('#8f8cf4')
    }
    await ui.press({ key: 'bar-dismiss' })
    expect(await ui.find({ key: 'bar-dismiss' } as never)).toBeUndefined()
    await ui.unmount()
  }
})

test("a helper agent's progress call counts on its own card, not the bar; a finished bar clears on the next turn", async ($, on) => {
  engine(on)
  beneathBand(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'sub1' }))
  await $.turn.start({ text: 'go', turnId: 'P1' })
  await $.agent.spawn(spawn('general-purpose', 'Review the parser'))
  await $.tool.call({ tool: 'mcp__spotter__progress', title: 'Audit', total: 2 } as never)
  await $.tool.call({ tool: 'mcp__spotter__progress', title: 'Not the bar', total: 5, done: 2, step: 'Reading the hooks', agentId: 'sub1' } as never)
  await $.tool.call({ tool: 'mcp__spotter__progress', finished: true } as never)
  const done = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await done.find({ text: /^Audit$/ })).toBeDefined()
  expect(await done.find({ text: /^Done/ })).toBeDefined()
  expect(await done.find({ text: /^Nailed it$/ })).toBeDefined()
  expect(await done.find({ text: /^🐨✨$/ })).toBeDefined() // "Audit" is checking: Depresso, Lucky once done
  await done.unmount()

  // The helper's card: its Pal, hatched and one star in at 2 of 5, and the count it reported.
  const term = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  expect(await term.find({ text: /^🐨$/ })).toBeDefined()
  expect(await term.find({ text: /^2\/5$/ })).toBeDefined()
  await term.press({ key: 'card-sub1' })
  expect(await term.find({ text: /^Depresso$/ })).toBeDefined() // its details name the Pal, its stars and its step
  expect(await term.find({ text: /^ ★$/ })).toBeDefined()
  expect(await term.find({ text: /Reading the hooks/ })).toBeDefined()
  await term.press({ key: 'card-sub1' })
  await term.unmount()
  const desk = await $.ui.mount({ ...pane(66), surface: 'desktop' })
  const svg = await desk.find({ type: 'Svg' } as never)
  expect(String(svg?.props.alt)).toBe('Depresso, 1 of 4 stars')
  expect(await desk.find({ text: /^Sonnet 5\.5$/ })).toBeDefined() // the model it runs on, at the right of its steps
  expect(String(svg?.props.source)).toContain('pal mv run')
  await desk.unmount()

  // Once it finishes, so has its plan.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'P1', agentId: 'sub1', reason: 'answer' })
  const after1 = await $.ui.mount({ ...pane(66), surface: 'terminal' })
  expect(await after1.find({ text: /^5\/5$/ })).toBeDefined()
  await after1.unmount()

  await $.turn.start({ text: 'next thing', turnId: 'P2' })
  const after = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await after.find({ text: /^Audit$/ })).toBeUndefined()
  await after.unmount()
})

test('the last reply draws as a headline over its numbers', async ($, on) => {
  engine(on)
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  for (const turnId of ['R1', 'R2']) {
    await $.turn.start({ text: 'go', turnId })
    await $.tool.call({ tool: 'Edit', file_path: '/x.ts', old_string: 'a', new_string: 'b' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 42_000, isAborted: false, turnId, reason: 'answer' })
  }
  const ui = await $.ui.mount({ ...pane(80), surface: 'terminal' })
  expect(await ui.find({ text: /^✓ Clean run: 1 file change, zero errors$/ })).toBeDefined()
  expect(await ui.find({ text: /2 clean replies in a row/ })).toBeDefined()
  // Folded into the top box: time on its own row, and only the counts that are not zero.
  expect(await ui.find({ text: /^Last reply$/ })).toBeDefined()
  expect(await ui.find({ text: /^42s$/ })).toBeDefined()
  expect(await ui.find({ text: /^1 file change$/ })).toBeDefined()
  expect(await ui.find({ text: /0 helpers|0 errors/ })).toBeUndefined()
  await ui.unmount()
})

// ---------------------------------------------------------------- the session box

test('the cache line counts down from the last request, and reads its lifetime from what was written', () => {
  expect(cacheLabel(47 * 60_000)).toEqual({ text: 'warm · ~47 min left', tone: 'plain' })
  expect(cacheLabel(9.2 * 60_000)).toEqual({ text: 'warm · ~10 min left', tone: 'soon' })
  expect(cacheLabel(0).tone).toBe('cold')
  expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 3088 } }, 300_000)).toBe(3_600_000)
  expect(cacheTtlOf({ cache_creation: { ephemeral_5m_input_tokens: 900, ephemeral_1h_input_tokens: 0 } }, 3_600_000)).toBe(300_000)
  expect(cacheTtlOf({ input_tokens: 5 }, 3_600_000)).toBe(3_600_000) // nothing written: keep what was known
  expect([limitLabel('five_hour'), limitLabel('seven_day'), limitLabel('spend_limit')]).toEqual(['5-hour limit', 'Weekly limit', 'spend limit'])
})

test('the session box shows context, limits and the cache at the top of the docked pane', async ($, on) => {
  engine(on, 1_000_000)
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 500_000, tokens: 190_000, percent: 38 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    },
  }))
  // eslint-disable-next-line require-yield
  on('turn.step', async function* () {
    return { turnId: 'U1', index: 0, answer: '', toolUses: [], usage: { input_tokens: 5, output_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: 10 } }, stopReason: 'end_turn' } as never
  })
  await $.turn.start({ text: 'go', turnId: 'U1' })
  // A stream: it runs as it is read.
  for await (const _chunk of $.turn.step({ turnId: 'U1', index: 0, model: 'claude-opus-5-5' } as never) as AsyncIterable<unknown>) void _chunk
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane(48), surface })
    expect(await ui.find({ text: /^ 38% used$/ })).toBeDefined()
    expect(await ui.find({ text: /^310k left of 500k$/ })).toBeDefined()
    expect(await ui.find({ text: /^5-hour limit$/ })).toBeDefined()
    expect(await ui.find({ text: /^12% used$/ })).toBeDefined()
    expect(await ui.find({ text: /^Cache$/ })).toBeDefined()
    // A session with no helpers says so under the box instead of leaving the pane blank.
    expect(await ui.find({ text: /No helpers yet/ })).toBeDefined()
    await ui.unmount()
  }
})

// ---------------------------------------------------------------- the terminal strip

test('in the terminal the strip above the prompt shows a line per helper while any runs, then the last reply', async ($, on) => {
  engine(on)
  beneathBand(on)
  const ids = ['h1', 'h2']
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: ids.shift() ?? 'x' }))
  await $.turn.start({ text: 'go', turnId: 'S1' })
  await $.agent.spawn(spawn('Explore', 'Map the folders'))
  await $.agent.spawn(spawn('general-purpose', 'Quick tidy pass'))
  await $.tool.call({ tool: 'mcp__spotter__progress', total: 3, done: 2, step: 'Listing files', agentId: 'h1' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'S1', agentId: 'h2', reason: 'answer' })

  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /^Map the folders$/ })).toBeDefined()
  expect(await ui.find({ text: /^Quick tidy pass$/ })).toBeDefined() // finished, but its batch is still running
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^★★$/ })).toBeDefined() // past halfway: two stars
  expect(await ui.find({ text: /^★★★★$/ })).toBeDefined() // the finished one is fully grown
  expect(await ui.find({ text: /^Haiku 5\.5$/ })).toBeDefined() // the model each helper runs on
  expect(await ui.find({ text: /^ · Listing files$/ })).toBeDefined()
  expect(await ui.find({ text: /^beneath the bar$/ })).toBeDefined()
  await ui.unmount()

  // The desktop app has the side panel for this: its band stays empty without a plan.
  const desk = await $.ui.mount({ ...band(100), surface: 'desktop' })
  expect(await desk.find({ text: /Map the folders/ })).toBeUndefined()
  await desk.unmount()

  // Once every helper is done their lines go, and the finished reply gets one line.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'S1', agentId: 'h1', reason: 'answer' })
  await $.turn.complete({ answer: 'done', durationMs: 42_000, isAborted: false, turnId: 'S1', reason: 'answer' })
  const after = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await after.find({ text: /Map the folders/ })).toBeUndefined()
  expect(await after.find({ text: /^✓ / })).toBeDefined()
  expect(await after.find({ text: /^ · 42s$/ })).toBeDefined()
  await after.unmount()
})

test('the strip does not say the time twice when the headline already has it', async ($, on) => {
  engine(on)
  beneathBand(on)
  await $.turn.start({ text: 'hi', turnId: 'Q1' })
  await $.turn.complete({ answer: 'hello', durationMs: 4_000, isAborted: false, turnId: 'Q1', reason: 'answer' })
  const ui = await $.ui.mount({ ...band(100), surface: 'terminal' })
  expect(await ui.find({ text: /^✓ Answered in 4s\. Blink and you missed it\.$/ })).toBeDefined()
  expect(await ui.find({ text: /· 4s/ })).toBeUndefined()
  await ui.unmount()
})

test('the side panel opens by itself in the desktop app, not in the terminal', async ($, on) => {
  engine(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/x', surface: 'terminal' } as never)
  expect(opened).toEqual([])
  await $.session.start({ cwd: '/x', surface: 'desktop' } as never)
  expect(opened).toEqual(['spotter'])
})
