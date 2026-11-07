export type ModRow = {
  /** The plugin id Claude Code switches: `<name>@<marketplace>`. */
  id: string
  name: string
  marketplace: string
  /** Where it's installed: user, project or local. */
  scope: string
  /** The project an install of project or local scope belongs to. */
  projectPath?: string
  version: string
  emoji: string
  title: string
  what: string
  usage: string
  accent: string
  isOn: boolean
  /** The mod manager itself, which has no switch. */
  isSelf: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'mod-manager': {
      mods: ModRow[]
      /** The id of the mod being switched right now, empty when none. */
      busy: string
      /** The last switch's outcome, shown under the cards. */
      note: string
      /** True once the first look at the installed mods is done. */
      isLoaded: boolean
    }
  }
}
