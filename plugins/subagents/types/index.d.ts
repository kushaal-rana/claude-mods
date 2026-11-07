export type Phase = 'running' | 'done' | 'failed' | 'stopped'

export type Helper = {
  /** The id agent.spawn answered; the subagent's own tool calls and turns carry it. */
  id: string
  /** The few words Claude gave the task. */
  task: string
  /** The agent type: general-purpose, Explore, a plugin's agent. */
  type: string
  /** The model's display name ("Sonnet 5.5"), empty until known. */
  model: string
  phase: Phase
  /** The step it's on, in plain words ("Reading README.md"); empty once it ends. */
  step: string
  tools: number
  /** Tokens its last model request read and wrote. */
  tokens: number
  startedAt: number
  endedAt?: number
  /** Which of the card colors it wears. */
  hue: number
}

declare module 'claude-code' {
  interface PluginState {
    subagents: {
      helpers: Helper[]
      /** Animation frame and the clock time of the last tick. */
      clock: { tick: number; now: number }
      /** The pane opens by itself once a chat, at the first subagent. */
      hasAutoOpened: boolean
      /** What the whole chat has cost so far at API prices, null where unknown. */
      chatCost: number | null
    }
  }
}
