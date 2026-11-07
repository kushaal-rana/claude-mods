export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: Limit[]
  costUsd?: number
  startedAt: number
  // The reading's time, in whole minutes, so the clock and countdowns redraw once a minute.
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-card': { snapshot: Snapshot | null; isOpen: boolean }
  }
}
