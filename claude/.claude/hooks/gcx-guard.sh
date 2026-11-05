#!/usr/bin/env bash
# PreToolUse hook: lets Claude run only read-only gcx (Grafana CLI) commands.
# Reads are tagged "R" in gcx-commands.txt (built by gcx-commands-gen.sh).
# Every write, every unknown gcx command, and every form the hook cannot parse is denied.

INPUT=$(cat)

# Fast path: no gcx in the call, nothing to check. The macOS disk ignores case,
# so GCX and Gcx run gcx too. Quotes and backslashes are removed first, because
# the shell runs g''cx and g\cx as gcx.
STRIPPED=${INPUT//[\"\'\\]/}
shopt -s nocasematch
case "$STRIPPED" in
  *gcx*) ;;
  *) exit 0 ;;
esac
shopt -u nocasematch

DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

command -v python3 >/dev/null 2>&1 ||
  deny "gcx is read-only for Claude, and the hook needs python3 to check it. Stop and tell the user."

read -r -d '' PY <<'PY'
import json
import re
import shlex
import sys

VALUE_FLAGS = {"--context", "--config", "-o", "--output", "--jq", "--json"}
# Global flags that take no value. Any other flag before the end of the command
# path can eat a word, so the hook cannot tell which command gcx runs.
BOOL_FLAGS = {"--agent", "--no-color", "--no-truncate", "-v", "-vv", "-vvv", "--verbose"}
WRAPPERS = {"env", "command", "exec", "time", "nohup", "rtk", "proxy"}
# Commands that can run gcx from their arguments, or bind a name to it.
RUNNERS = {"sh", "bash", "zsh", "fish", "eval", "xargs", "ssh", "watch", "parallel", "source", ".",
           "python", "python3", "node", "perl", "ruby", "awk", "osascript",
           "alias", "export", "declare", "typeset", "local", "readonly"}
HELP_FLAGS = {"-h", "--help"}
GCX_WORD = re.compile(r"(?<![\w.-])gcx(?![\w.-])", re.IGNORECASE)
PUNCT = set("();<>|&")
ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "gcx is read-only for Claude. " + reason
        + " Stop and tell the user. Show the exact command; the user runs it with ! if they want it.",
    }}))
    sys.exit(0)


def clean(tok):
    return tok.strip("'\"`\\")


def name(tok):
    return clean(tok).rsplit("/", 1)[-1]


def is_gcx(tok):
    return name(tok).lower() == "gcx"


def load_tags(path):
    tags = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                tag, _, cmd = line.partition(" ")
                tags[cmd] = tag
    return tags


def split_segments(cmd):
    # A newline ends a command in the shell, but shlex reads it as a space.
    lexer = shlex.shlex(cmd.replace("\n", " ; "), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    segments, cur = [], []
    for tok in lexer:
        if tok and set(tok) <= PUNCT:
            segments.append(cur)
            cur = []
        else:
            cur.append(tok)
    segments.append(cur)
    return [s for s in segments if s]


def check_api(args):
    for j, raw in enumerate(args):
        a = clean(raw)
        flag, eq, val = a.partition("=")
        nxt = clean(args[j + 1]) if j + 1 < len(args) else ""
        if flag in ("-X", "--method"):
            if (val if eq else nxt).upper() != "GET":
                deny("gcx api with a method other than GET is a write.")
        elif flag.startswith("-X") and flag[2:].upper() != "GET":
            deny("gcx api with a method other than GET is a write.")
        elif flag in ("-d", "--data", "--input") or flag.startswith("--data") or (
                flag.startswith("-d") and not flag.startswith("--")):
            deny("gcx api with a request body is a write.")
        elif "method-override" in a.lower():
            deny("gcx api with a method override header is a write.")


def check_segment(seg, tags):
    if not any(GCX_WORD.search(t) for t in seg):
        return
    if any(GCX_WORD.search(t) and ("$(" in t or "`" in t) for t in seg):
        deny("The command runs gcx inside $( ) or backticks, so the hook cannot check it.")
    i = 0
    while i < len(seg) and (ASSIGN.match(seg[i]) or name(seg[i]) in WRAPPERS):
        i += 1
    if i >= len(seg) or not is_gcx(seg[i]):
        head = name(seg[i]).lower() if i < len(seg) else ""
        runner = head in RUNNERS or head.rstrip("0123456789.") in RUNNERS
        if runner or any(is_gcx(t) or (ASSIGN.match(t) and GCX_WORD.search(t)) for t in seg):
            deny("gcx is not the first word of the command, so the hook cannot check it.")
        return
    args = seg[i + 1:]
    if any(is_gcx(t) for t in args):
        deny("The command has gcx twice, so the hook cannot check it.")
    if any(clean(a) in HELP_FLAGS for a in args):
        return
    pos, unknown_flag_at, j = [], None, 0
    while j < len(args):
        a = clean(args[j])
        if a.startswith("-"):
            flag, eq, _ = a.partition("=")
            if flag in VALUE_FLAGS:
                j += 1 if eq else 2
                continue
            if flag not in BOOL_FLAGS and unknown_flag_at is None:
                unknown_flag_at = len(pos)
            j += 1
            continue
        pos.append(a)
        j += 1
    for k in range(len(pos), 0, -1):
        path = " ".join(pos[:k])
        if path in tags:
            break
    else:
        deny("'gcx " + " ".join(pos[:3]) + "' is not a known command. If it is a read, "
             "ask the user to run ~/.claude/hooks/gcx-commands-gen.sh.")
    if unknown_flag_at is not None and unknown_flag_at < k:
        deny("A flag before the end of 'gcx " + path + "' hides which command gcx runs. "
             "Put flags after the command.")
    if tags[path] != "R":
        deny("'gcx " + path + "' is a write.")
    if path == "api":
        check_api(args)


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        deny("The hook could not read the tool input.")
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not GCX_WORD.search(re.sub(r"""["'\\]""", "", cmd)):
        return
    if "--insecure-log-http-payload" in cmd:
        deny("--insecure-log-http-payload prints tokens into the chat.")
    try:
        tags = load_tags(sys.argv[1] + "/gcx-commands.txt")
    except OSError:
        deny("gcx-commands.txt is missing. Ask the user to run ~/.claude/hooks/gcx-commands-gen.sh.")
    try:
        segments = split_segments(cmd)
    except ValueError:
        deny("The hook could not parse the command.")
    for seg in segments:
        check_segment(seg, tags)


main()
PY

printf '%s' "$INPUT" | python3 -I -c "$PY" "$DIR" ||
  deny "gcx is read-only for Claude, and the hook failed. Stop and tell the user."
