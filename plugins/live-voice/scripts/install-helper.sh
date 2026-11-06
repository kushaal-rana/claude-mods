#!/bin/bash
# Builds live-voice's audio helper from source and installs it to ~/.claude-voice/bin,
# where the mod looks for it. Needs Apple's command line tools (xcode-select --install).
# The first build takes about three minutes; voice and speech models download on first use.
set -euo pipefail

mod_dir="$(cd "$(dirname "$0")/.." && pwd)"
home_dir="$HOME/.claude-voice"

mkdir -p "$home_dir/bin" "$home_dir/run"
chmod 700 "$home_dir/run"

echo "Building the live-voice helper (release)..."
swift build -c release --package-path "$mod_dir/helper" --scratch-path "$home_dir/build"

cp "$home_dir/build/release/claude-voice-helper" "$home_dir/bin/claude-voice-helper"
echo "Installed $home_dir/bin/claude-voice-helper"
echo "Quick check: $home_dir/bin/claude-voice-helper --say \"Hello from live voice.\""
