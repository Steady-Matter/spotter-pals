export type Main = {
  isRunning: boolean
  /** When the main conversation's last request finished; 0 before the first. The cache countdown starts here. */
  lastRequestAt: number
  /** How long the prompt cache lasts after a request: an hour, or five minutes when the requests say so. */
  cacheTtlMs: number
}

export type ToolNote = { text: string; isError: boolean }

export type AgentCard = {
  id: string
  type: string
  model: string
  description: string
  status: string
  spawnedAt: number
  endedAt: number | null
  /** The agent's context now: input + cache read + cache write of its latest step. */
  ctx: number
  steps: number
  lastStop: string | null
  tools: ToolNote[]
  answer: string
  /** Its own plan, when it reports one through the `progress` tool; null until it does. */
  stepDone: number | null
  stepTotal: number | null
  stepNote: string
}

export type Turn = {
  edits: number
  errors: number
  startedAt: number
  costAtStart: number | null
}

export type Receipt = {
  durationMs: number
  agents: number
  edits: number
  errors: number
  costDelta: number | null
  reason: string
  /** Replies in a row, this one included, that finished with no errors. */
  streak: number
}

export type View = { expanded: string | null }

/** The plan Claude reported through the `progress` tool: what the bar above the prompt draws. */
export type Plan = {
  title: string
  total: number
  done: number
  isFinished: boolean
  /** What the step now under way is, in Claude's words; empty when it did not say. */
  step: string
  /** When the plan began and ended; 0 and null when unknown. */
  startedAt: number
  endedAt: number | null
}

/** The Pal that stands for an agent, picked from the kind of job it runs. */
export type Pal = 'vixy' | 'depresso' | 'anubis' | 'lifmunk' | 'hoocrates' | 'foxparks'

/** How a Pal is drawn: `stars` 0 is the egg and 4 fully grown; Lucky is the rare bigger one; down is knocked out. */
export type PalLook = { stars: 0 | 1 | 2 | 4; isLucky: boolean; isDown: boolean }

declare module 'claude-code' {
  interface PluginState {
    'spotter': {
      main: Main
      agents: AgentCard[]
      turn: Turn
      receipt: Receipt | null
      view: View
      plan: Plan | null
    }
  }
}
