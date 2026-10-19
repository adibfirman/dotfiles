#!/usr/bin/env bash
# Subagent status line: one row body per subagent in the agent panel.
# Row: name · model · effort · label · tokens. Fed {columns, tasks[]} JSON on stdin by Claude Code.
# Prints one {"id","content"} JSON line per task; a task left out keeps its default row.

jq -c '
  # "claude-sonnet-5-5" -> "Sonnet 5.5"; unknown IDs stay as-is
  def pretty_model:
    (capture("^claude-(?<fam>[a-z]+)-(?<maj>[0-9]+)(?:-(?<min>[0-9]{1,2}))?(?:$|[-\\[])") // null) as $m
    | if $m == null then .
      else ($m.fam[0:1] | ascii_upcase) + $m.fam[1:] + " " + $m.maj
           + (if $m.min then "." + $m.min else "" end)
      end;
  def hk:
    if . >= 1000000 then ((. / 100000 + 0.5 | floor) / 10 | tostring | sub("\\.0$"; "")) + "M"
    elif . >= 1000 then (((. + 500) / 1000 | floor) | tostring) + "k"
    else tostring end;

  "\u001b[0m" as $rst | "\u001b[38;5;244m" as $dim | "\u001b[38;5;141m" as $mcol
  | ($dim + " · " + $rst) as $sep
  | (.columns // 80) as $cols
  | .tasks[]?
  | (.name // .agentType // "agent") as $name
  | ((.model // "") | if . == "" then "" else pretty_model end) as $model
  | ((.effort // "") | tostring) as $effort
  | (.label // .description // "") as $label
  | ((.tokenCount // 0) | hk) as $tok
  # label gets whatever width is left after the fixed parts and their separators
  | ([$name, $model, $effort, $tok] | map(select(. != ""))) as $fixed
  | ($cols - ($fixed | map(length) | add) - 3 * ($fixed | length)) as $room
  | (if $room < 4 or $label == "" then ""
     elif ($label | length) > $room then $label[0:$room - 1] + "…"
     else $label end) as $lbl
  | {
      id: .id,
      content: (
        [ $name,
          (if $model != "" then $mcol + $model + $rst else "" end),
          (if $effort != "" then $dim + $effort + $rst else "" end),
          $lbl,
          ($dim + $tok + $rst) ]
        | map(select(. != "")) | join($sep)
      )
    }
' 2>/dev/null
