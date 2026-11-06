export type VoicePhase =
  | 'off'
  | 'starting'
  | 'ready'
  | 'preparing'
  | 'speaking'
  | 'paused'
  | 'working'
  | 'listening'
  | 'error'

export type VoiceReading = {
  id: string
  label: string
  sentences: string[]
  i: number
}

declare module 'claude-code' {
  interface PluginState {
    'live-voice': {
      isOn: boolean
      phase: VoicePhase
      note: string
      reading: Shaped<VoiceReading | null>
      suspended: Shaped<VoiceReading | null>
      rate: number
      voice: string
      mode: string
      workingSince: number
      tick: number
      micOn: boolean
      heard: string
      sending: string
    }
  }
}
