// The bottom-bar pill: its text, and whether it's lit up because a break is due right now.
export type Pill = { label: string; isBreakTime: boolean }

declare module 'claude-code' {
  interface PluginState {
    'break-reminder': { pill: Pill | null; stripUntil: number }
  }
}
