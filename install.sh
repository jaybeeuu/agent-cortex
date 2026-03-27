#!/usr/bin/env bash
set -euo pipefail

REPO="jaybeeuu/agent-nexus"

# ── Helpers ────────────────────────────────────────────────────────────────────

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

die() { red "error: $*" >&2; exit 1; }

require() {
  command -v "$1" &>/dev/null || die "'$1' is required but was not found in PATH."
}

# Merge $new_json into $file using jq deep merge, creating the file if absent.
merge_json() {
  local file="$1"
  local new_json="$2"

  require jq

  mkdir -p "$(dirname "$file")"

  if [[ -s "$file" ]]; then
    local merged
    merged=$(jq --argjson new "$new_json" '. * $new' "$file") \
      || die "Failed to merge JSON into $file"
    printf '%s\n' "$merged" > "$file"
  else
    printf '%s\n' "$new_json" | jq '.' > "$file"
  fi
}

# ── VS Code user settings ──────────────────────────────────────────────────────

vscode_settings_path() {
  case "$(uname -s)" in
    Darwin)
      echo "$HOME/Library/Application Support/Code/User/settings.json"
      ;;
    MINGW*|CYGWIN*|MSYS*|Windows_NT)
      # Native Windows shells (Git Bash, Cygwin, MSYS2).
      # WSL reports as 'Linux' and uses the Linux path below, which is correct.
      echo "${APPDATA:-$HOME/AppData/Roaming}/Code/User/settings.json"
      ;;
    *)
      echo "${XDG_CONFIG_HOME:-$HOME/.config}/Code/User/settings.json"
      ;;
  esac
}

install_vscode() {
  local settings
  settings=$(vscode_settings_path)

  bold "Configuring VS Code MCP server → $settings"

  local mcp_entry
  mcp_entry=$(cat <<'JSON'
{
  "mcp": {
    "servers": {
      "agent-nexus": {
        "command": "npx",
        "args": ["--yes", "github:jaybeeuu/agent-nexus"]
      }
    }
  }
}
JSON
)

  merge_json "$settings" "$mcp_entry"
  green "VS Code: agent-nexus MCP server registered."
}

# ── Copilot CLI ────────────────────────────────────────────────────────────────

install_copilot_cli() {
  bold "Installing plugin into Copilot CLI → ~/.copilot"

  # gh copilot delegates to the copilot binary; use 'copilot' if on PATH,
  # otherwise fall back to the gh wrapper.
  if command -v copilot &>/dev/null; then
    copilot plugin install "$REPO"
  elif command -v gh &>/dev/null; then
    gh copilot -- plugin install "$REPO"
  else
    die "Neither 'copilot' nor 'gh' (GitHub CLI) was found in PATH."
  fi

  green "Copilot CLI: agent-nexus plugin installed."
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  bold "Installing agent-nexus from github.com/$REPO (main)"
  echo

  local installed_any=false

  # Install for Copilot CLI if available
  if command -v copilot &>/dev/null || command -v gh &>/dev/null; then
    install_copilot_cli
    installed_any=true
  else
    red "Skipping Copilot CLI install: neither 'copilot' nor 'gh' found."
  fi

  echo

  # Install for VS Code if the CLI is available
  if command -v code &>/dev/null || command -v code-insiders &>/dev/null; then
    install_vscode
    installed_any=true
  else
    red "Skipping VS Code install: neither 'code' nor 'code-insiders' found in PATH."
  fi

  echo
  if $installed_any; then
    green "Done. Restart Copilot CLI / VS Code to pick up the new plugin."
  else
    die "Nothing was installed — install Copilot CLI or VS Code first."
  fi
}

main "$@"
