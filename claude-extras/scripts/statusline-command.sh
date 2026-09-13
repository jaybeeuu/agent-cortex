#!/bin/bash
# Claude Code statusLine: shows model name and context-window usage as a small
# colored progress bar, with used% (color-coded) and used/total token counts
# in compact form, e.g.:
#   Sonnet 5 ~/src [████░░░░░░] 17% 13k / 1M

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
used_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
total_tokens=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
agent_name=$(echo "$input" | jq -r '.agent.name // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
cwd_display="${cwd/#$HOME/~}"

# Collapse long paths to their first two and last two components, e.g.
#   ~/src/jaybeeuu/thing/agent-cortex -> ~/src/.../thing/agent-cortex
# Only applied when there are more than 4 total path components (so short
# paths like ~/src or paths with exactly 4 components are left untouched).
if [ -n "$cwd_display" ]; then
  path_prefix=""
  case "$cwd_display" in
    /*) path_prefix="/" ;;
  esac

  IFS='/' read -ra _cwd_all_parts <<< "$cwd_display"
  _cwd_parts=()
  for _p in "${_cwd_all_parts[@]}"; do
    [ -n "$_p" ] && _cwd_parts+=("$_p")
  done
  _cwd_count=${#_cwd_parts[@]}

  if [ "$_cwd_count" -gt 4 ]; then
    _last_idx=$(( _cwd_count - 1 ))
    _second_last_idx=$(( _cwd_count - 2 ))
    cwd_display="${path_prefix}${_cwd_parts[0]}/${_cwd_parts[1]}/.../${_cwd_parts[_second_last_idx]}/${_cwd_parts[_last_idx]}"
  fi
fi

RESET="\033[0m"
BOLD="\033[1m"
CYAN="\033[1;96m"
GREEN="\033[1;92m"
YELLOW="\033[1;93m"
RED="\033[1;91m"
WHITE="\033[1;97m"
MAGENTA="\033[1;95m"
BLUE="\033[1;94m"

# Effort level shown right after the model name, e.g. "Sonnet 5 [high]"
effort_str=""
[ -n "$effort" ] && effort_str=" ${MAGENTA}[${effort}]${RESET}"

# Active agent/subagent name (only present when Claude is started with --agent)
agent_str=""
[ -n "$agent_name" ] && agent_str=" ${BLUE}(${agent_name})${RESET}"

# Current working directory
cwd_str=""
[ -n "$cwd_display" ] && cwd_str=" ${YELLOW}${cwd_display}${RESET}"

# Bar width in characters. Kept small so the percentage number (colored
# below) carries most of the visual weight rather than the bar itself.
bar_width=10

# Context-usage color thresholds (percent). Adjustable: green below
# warn_threshold, yellow from warn_threshold up to crit_threshold, red at
# crit_threshold and above.
warn_threshold=40
crit_threshold=80

# Format a raw token count compactly: 13000 -> 13k, 1200000 -> 1.2M
format_tokens() {
  local n=$1
  if [ -z "$n" ]; then
    echo ""
    return
  fi
  awk -v n="$n" 'BEGIN {
    if (n >= 1000000) {
      v = n / 1000000
      printf (v == int(v)) ? "%dM" : "%.1fM", v
    } else if (n >= 1000) {
      v = n / 1000
      printf (v == int(v)) ? "%dk" : "%.0fk", v
    } else {
      printf "%d", n
    }
  }'
}

if [ -n "$used" ]; then
  used_int=$(printf '%.0f' "$used")
  [ "$used_int" -lt 0 ] && used_int=0
  [ "$used_int" -gt 100 ] && used_int=100

  filled=$(( used_int * bar_width / 100 ))
  [ "$filled" -gt "$bar_width" ] && filled=$bar_width
  empty=$(( bar_width - filled ))

  if [ "$used_int" -ge "$crit_threshold" ]; then
    bar_color="$RED"
  elif [ "$used_int" -ge "$warn_threshold" ]; then
    bar_color="$YELLOW"
  else
    bar_color="$GREEN"
  fi

  bar=""
  [ "$filled" -gt 0 ] && bar=$(printf "%${filled}s" | tr ' ' '█')
  bar_empty=""
  [ "$empty" -gt 0 ] && bar_empty=$(printf "%${empty}s" | tr ' ' '░')

  tokens_str=""
  if [ -n "$used_tokens" ] && [ -n "$total_tokens" ]; then
    tokens_str=" $(format_tokens "$used_tokens") / $(format_tokens "$total_tokens")"
  fi

  printf "${CYAN}%s${RESET}%b%b%b ${WHITE}[${bar_color}%s${WHITE}%s${RESET}${WHITE}]${RESET} ${bar_color}%s%%${RESET}%s" "$model" "$effort_str" "$agent_str" "$cwd_str" "$bar" "$bar_empty" "$used_int" "$tokens_str"
else
  printf "${CYAN}%s${RESET}%b%b%b ${WHITE}[context: n/a]${RESET}" "$model" "$effort_str" "$agent_str" "$cwd_str"
fi
