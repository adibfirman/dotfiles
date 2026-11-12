#!/usr/bin/env bash
# Custom statusline: model, idle compaction bar, countdown to idle compaction, folder.
# Fed session JSON on stdin by Claude Code.

INPUT=$(cat)
RST=$'\033[0m'; DIM=$'\033[38;5;244m'

# --- draw a bar for a 0-100 pct: bar <pct> [width] ---
bar() {
  local pct=$1 w=${2:-10} f i out=""
  [ "$pct" -lt 0 ] && pct=0; [ "$pct" -gt 100 ] && pct=100
  f=$(( pct * w / 100 ))
  for ((i=0;i<w;i++)); do [ $i -lt $f ] && out+="█" || out+="░"; done
  printf '%s' "$out"
}
# color by usage pct: low=green, mid=yellow, high=red
ucol() { if [ "$1" -lt 60 ]; then printf '\033[38;5;42m'; elif [ "$1" -lt 85 ]; then printf '\033[38;5;220m'; else printf '\033[38;5;196m'; fi; }
sep() { printf ' %s|%s ' "$DIM" "$RST"; }

# ===== MODEL NAME + EFFORT =====
MODEL_NAME=$(printf '%s' "$INPUT" | jq -r '.model.display_name // empty')
EFFORT=$(printf '%s' "$INPUT" | jq -r '.effort.level // empty')
[ -n "$MODEL_NAME" ] && printf '  \033[38;5;141m%s%s' "$MODEL_NAME" "$RST"
[ -n "$EFFORT" ] && printf ' %s[%s]%s' "$DIM" "$EFFORT" "$RST"

# ===== TOKENS USED (native context_window fields, Claude Code >= 2.1.132) =====
# Prefer Claude Code's own numbers (context_window.*). Fall back to the transcript
# if current_usage is missing (e.g. no assistant turn yet).
hk() {
  local n=$1
  if [ "$n" -ge 1000000 ]; then awk -v n="$n" 'BEGIN{printf "%.1fM", n/1000000}' | sed 's/\.0M$/M/'
  elif [ "$n" -ge 1000 ]; then printf '%dk' $(( (n + 500) / 1000 ))
  else printf '%d' "$n"; fi
}
CW=$(printf '%s' "$INPUT" | jq -c '.context_window // {}')
USED=$(printf '%s' "$CW" | jq -r '.current_usage // empty | ((.input_tokens//0)+(.cache_creation_input_tokens//0)+(.cache_read_input_tokens//0))')
if [ -z "$USED" ]; then
  TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty')
  USED=0
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    USED=$(jq -s '
      map(select(.message.usage and (.isSidechain != true) and (.type=="assistant")))
      | (last // {}) | .message.usage
      | ((.input_tokens//0)+(.cache_creation_input_tokens//0)+(.cache_read_input_tokens//0))
    ' "$TRANSCRIPT" 2>/dev/null)
    [ -z "$USED" ] && USED=0
  fi
fi

# ===== IDLE COMPACTION (threshold from CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS) =====
SETTINGS="$HOME/.claude/settings.json"
IDLE_OFF=0
IDLE_MET=0
case "${DISABLE_AUTO_COMPACT:-}" in ''|0|false) ;; *) IDLE_OFF=1 ;; esac
if [ -f "$SETTINGS" ] && jq -e '(.idleCompaction == false) or (.autoCompactEnabled == false)' "$SETTINGS" >/dev/null 2>&1; then IDLE_OFF=1; fi
TTL=$(printf '%s' "$INPUT" | jq -r '.prompt_cache.ttl // empty')
TH=${CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS:-}
case "$TH" in ''|*[!0-9]*) TH=200000 ;; esac
TH=$((10#$TH))
[ "$TH" -le 0 ] && TH=200000
[ "$TH" -lt 100000 ] && TH=100000
sep
if [ "$IDLE_OFF" -eq 1 ]; then
  printf '%sidle off%s' "$DIM" "$RST"
elif [ -n "$TTL" ] && [ "$TTL" != "1h" ]; then
  printf '%sidle ttl %s%s' "$DIM" "$TTL" "$RST"
else
  IPCT=$(( USED * 100 / TH ))
  printf '%sidle[%s%%] %s%s %s%s/%s%s' "$(ucol "$IPCT")" "$IPCT" "$(bar "$IPCT" 10)" "$RST" "$DIM" "$(hk "$USED")" "$(hk "$TH")" "$RST"
  [ "$TTL" = "1h" ] && [ "$USED" -ge "$TH" ] && IDLE_MET=1
fi

# ===== COUNTDOWN (estimate: idle compaction runs just before the prompt cache expires) =====
EXP=$(printf '%s' "$INPUT" | jq -r '.prompt_cache.expires_at // empty | floor')
case "$EXP" in ''|*[!0-9]*) EXP=0 ;; esac
LEFT=$(( EXP - $(date +%s) ))
if [ "$IDLE_MET" -eq 1 ] && [ "$LEFT" -gt 0 ]; then
  sep
  if [ "$LEFT" -lt 60 ]; then printf '%sT-<1m%s' "$DIM" "$RST"; else printf '%sT-%sm%s' "$DIM" "$(( LEFT / 60 ))" "$RST"; fi
fi

# ===== FOLDER =====
DIR=$(printf '%s' "$INPUT" | jq -r '.workspace.current_dir // .cwd // empty')
[ -n "$DIR" ] && { sep; printf '%s' "${DIR##*/}"; }

# ===== USAGE CACHE (OAuth usage API, cached 60s, read by the herdr claude-usage mod) =====
CACHE="$HOME/.claude/.usage-cache.json"
CACHE_TTL=60
now=$(date +%s)
mtime=0; [ -f "$CACHE" ] && mtime=$(stat -f %m "$CACHE" 2>/dev/null || echo 0)
if [ $(( now - mtime )) -ge $CACHE_TTL ]; then
  # refresh in background so statusline never blocks; only replace cache when
  # the response actually contains usage data (errors would clobber good data)
  (
    TOK=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | jq -r '.claudeAiOauth.accessToken // empty')
    [ -n "$TOK" ] && curl -s -m 8 \
      -H "Authorization: Bearer $TOK" \
      -H "anthropic-beta: oauth-2025-04-20" \
      "https://api.anthropic.com/api/oauth/usage" -o "$CACHE.tmp" 2>/dev/null \
      && jq -e '.five_hour and .seven_day' "$CACHE.tmp" >/dev/null 2>&1 \
      && mv "$CACHE.tmp" "$CACHE" 2>/dev/null
    rm -f "$CACHE.tmp" 2>/dev/null
  ) >/dev/null 2>&1 &
fi
