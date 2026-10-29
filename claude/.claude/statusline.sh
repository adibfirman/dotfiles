#!/usr/bin/env bash
# Custom statusline: model + context bar + 5h and weekly usage bars.
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

# ===== MODEL NAME + EFFORT =====
MODEL_NAME=$(printf '%s' "$INPUT" | jq -r '.model.display_name // empty')
EFFORT=$(printf '%s' "$INPUT" | jq -r '.effort.level // empty')
[ -n "$MODEL_NAME" ] && printf '  \033[38;5;141m%s%s' "$MODEL_NAME" "$RST"
[ -n "$EFFORT" ] && printf ' %s· %s%s' "$DIM" "$EFFORT" "$RST"

# ===== CONTEXT (native context_window fields, Claude Code >= 2.1.132) =====
# --- Context window: tokens used / window size + percent ---
# Prefer Claude Code's own numbers (context_window.*). Fall back to the transcript
# if current_usage is missing (e.g. no assistant turn yet).
hk() {
  local n=$1
  if [ "$n" -ge 1000000 ]; then awk -v n="$n" 'BEGIN{printf "%.1fM", n/1000000}' | sed 's/\.0M$/M/'
  elif [ "$n" -ge 1000 ]; then printf '%dk' $(( (n + 500) / 1000 ))
  else printf '%d' "$n"; fi
}
CW=$(printf '%s' "$INPUT" | jq -c '.context_window // {}')
WINDOW=$(printf '%s' "$CW" | jq -r '.context_window_size // empty')
[ -z "$WINDOW" ] && WINDOW=1000000
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
CPCT=$(printf '%s' "$CW" | jq -r '.used_percentage // empty')
CPCT=${CPCT%.*}
[ -z "$CPCT" ] && CPCT=$(( USED * 100 / WINDOW ))
CCOL=$(ucol "$CPCT")
printf '  %sctx[%s%%] %s%s %s%s/%s%s' "$CCOL" "$CPCT" "$(bar "$CPCT" 10)" "$RST" "$DIM" "$(hk "$USED")" "$(hk "$WINDOW")" "$RST"

# ===== 5-HOUR SESSION USAGE (from OAuth usage API, cached 30s) =====
CACHE="$HOME/.claude/.usage-cache.json"
TTL=60
now=$(date +%s)
mtime=0; [ -f "$CACHE" ] && mtime=$(stat -f %m "$CACHE" 2>/dev/null || echo 0)
if [ $(( now - mtime )) -ge $TTL ]; then
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
if [ -f "$CACHE" ]; then
  SUTIL=$(jq -r '.five_hour.utilization // empty' "$CACHE" 2>/dev/null)
  SRESET=$(jq -r '.five_hour.resets_at // empty' "$CACHE" 2>/dev/null)
  if [ -n "$SUTIL" ]; then
    SP=${SUTIL%.*}; [ -z "$SP" ] && SP=0
    SCOL=$(ucol "$SP")
    # reset countdown
    RTXT=""
    if [ -n "$SRESET" ]; then
      clean=$(printf '%s' "$SRESET" | sed -E 's/\.[0-9]+//; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')
      tgt=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$clean" +%s 2>/dev/null)
      if [ -n "$tgt" ]; then
        d=$(( tgt - now )); [ $d -lt 0 ] && d=0
        h=$(( d/3600 )); m=$(( (d%3600)/60 ))
        if [ $h -gt 0 ]; then RTXT=$(printf ' %dh%02dm' $h $m); else RTXT=$(printf ' %dm' $m); fi
      fi
    fi
    printf '  %s5h[%s%%] %s%s%s%s' "$SCOL" "$SP" "$(bar "$SP" 10)" "$RST" "$DIM" "$RTXT$RST"
  fi

  # weekly (7-day, all models)
  WSEG="" MSEG=""
  WUTIL=$(jq -r '.seven_day.utilization // empty' "$CACHE" 2>/dev/null)
  WRESET=$(jq -r '.seven_day.resets_at // empty' "$CACHE" 2>/dev/null)
  if [ -n "$WUTIL" ]; then
    WP=${WUTIL%.*}; [ -z "$WP" ] && WP=0
    WCOL=$(ucol "$WP")
    WTXT=""
    if [ -n "$WRESET" ]; then
      wclean=$(printf '%s' "$WRESET" | sed -E 's/\.[0-9]+//; s/([+-][0-9]{2}):([0-9]{2})$/\1\2/')
      wtgt=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$wclean" +%s 2>/dev/null)
      if [ -n "$wtgt" ]; then
        wd=$(( wtgt - now )); [ $wd -lt 0 ] && wd=0
        wdd=$(( wd/86400 )); wh=$(( (wd%86400)/3600 )); wm=$(( (wd%3600)/60 ))
        if [ $wdd -gt 0 ]; then WTXT=$(printf ' %dd%dh' $wdd $wh)
        elif [ $wh -gt 0 ]; then WTXT=$(printf ' %dh%02dm' $wh $wm)
        else WTXT=$(printf ' %dm' $wm); fi
      fi
    fi
    WSEG=$(printf '%sOthers[%s%%] %s%s%s%s' "$WCOL" "$WP" "$(bar "$WP" 10)" "$RST" "$DIM" "$WTXT$RST")
  fi

  # weekly model-scoped limit (e.g. Fable); same reset window as 7d so reuse its countdown
  MPCT=$(jq -r '[.limits[]? | select(.kind=="weekly_scoped")][0].percent // empty' "$CACHE" 2>/dev/null)
  MLBL=$(jq -r '[.limits[]? | select(.kind=="weekly_scoped")][0].scope.model.display_name // "model"' "$CACHE" 2>/dev/null)
  if [ -n "$MPCT" ]; then
    MP=${MPCT%.*}; [ -z "$MP" ] && MP=0
    MCOL=$(ucol "$MP")
    MSEG=$(printf '%s%s[%s%%] %s%s%s%s' "$MCOL" "$MLBL" "$MP" "$(bar "$MP" 10)" "$RST" "$DIM" "$WTXT$RST")
  fi

  # weekly group: pipe separator, model-scoped first, then the rest
  if [ -n "$MSEG$WSEG" ]; then
    printf '  %s|%s' "$DIM" "$RST"
    [ -n "$MSEG" ] && printf '  %s' "$MSEG"
    [ -n "$WSEG" ] && printf '  %s' "$WSEG"
  fi
fi
