import type { Plugin } from "@opencode-ai/plugin"

/**
 * RTK Command Rewrite Plugin for OpenCode
 * 
 * Transparently rewrites shell commands to use `rtk` for token-optimized output.
 * Based on rtk-ai/rtk src/discover/rules.rs registry.
 * 
 * Automatically loaded from ~/.config/opencode/plugins/
 */

// ============================================
// REWRITE RULES
// ============================================

// Each entry: [rtkCommand, [...prefixesToReplace]] (longest prefix first)
const REWRITE_RULES: [string, string[]][] = [
  ["rtk git",            ["git"]],
  ["rtk gh",             ["gh"]],
  ["rtk cargo",          ["cargo"]],
  ["rtk pnpm",           ["pnpm"]],
  ["rtk npm",            ["npm"]],
  ["rtk npx",            ["npx"]],
  ["rtk read",           ["cat", "head", "tail"]],
  ["rtk grep",           ["rg", "grep"]],
  ["rtk ls",             ["ls"]],
  ["rtk find",           ["find"]],
  ["rtk tsc",            ["pnpm tsc", "npx tsc", "tsc"]],
  ["rtk lint",           ["npx eslint", "pnpm lint", "npx biome", "eslint", "biome", "lint"]],
  ["rtk prettier",       ["npx prettier", "pnpm prettier", "prettier"]],
  ["rtk next",           ["npx next build", "pnpm next build", "next build"]],
  ["rtk vitest",         ["pnpm vitest", "npx vitest", "vitest", "jest"]],
  ["rtk playwright",     ["npx playwright", "pnpm playwright", "playwright"]],
  ["rtk prisma",         ["npx prisma", "pnpm prisma", "prisma"]],
  ["rtk docker",         ["docker"]],
  ["rtk kubectl",        ["kubectl"]],
  ["rtk tree",           ["tree"]],
  ["rtk diff",           ["diff"]],
  ["rtk curl",           ["curl"]],
  ["rtk wget",           ["wget"]],
  ["rtk mypy",           ["python3 -m mypy", "python -m mypy", "mypy"]],
  ["rtk ruff",           ["ruff"]],
  ["rtk pytest",         ["python -m pytest", "pytest"]],
  ["rtk pip",            ["pip3", "uv pip", "pip"]],
  ["rtk go",             ["go"]],
  ["rtk golangci-lint",  ["golangci-lint", "golangci"]],
  ["rtk aws",            ["aws"]],
  ["rtk psql",           ["psql"]],
]

// Commands to ignore (shell builtins, trivial operations)
const IGNORED_PREFIXES = [
  "cd ", "echo ", "printf ", "export ", "source ", "mkdir ", "rm ", "mv ", "cp ",
  "chmod ", "chown ", "touch ", "which ", "type ", "command ", "test ", "sleep ",
  "wait ", "kill ", "set ", "unset ", "wc ", "sort ", "uniq ", "tr ", "cut ",
  "awk ", "sed ", "python3 -c", "python -c", "node -e", "ruby -e", "rtk ",
  "pwd", "bash ", "sh ", "for ", "while ", "if ", "case ",
]

const IGNORED_EXACT = ["cd", "echo", "true", "false", "wait", "pwd", "bash", "sh", "fi", "done"]

// ============================================
// REWRITE LOGIC
// ============================================

/**
 * Check if command should be ignored
 */
function shouldIgnore(cmd: string): boolean {
  const trimmed = cmd.trim()
  
  if (IGNORED_EXACT.includes(trimmed)) {
    return true
  }
  
  for (const prefix of IGNORED_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      return true
    }
  }
  
  return false
}

/**
 * Strip word prefix with boundary check
 * Returns remainder after prefix, or null if no match
 */
function stripWordPrefix(cmd: string, prefix: string): string | null {
  if (cmd === prefix) {
    return ""
  }
  if (cmd.startsWith(prefix) && cmd.length > prefix.length && cmd[prefix.length] === " ") {
    return cmd.slice(prefix.length + 1).trimStart()
  }
  return null
}

/**
 * Extract environment prefix (sudo, env VAR=val, VAR=val)
 */
function extractEnvPrefix(cmd: string): [string, string] {
  const envPrefixRegex = /^(?:sudo\s+|env\s+|[A-Z_][A-Z0-9_]*=[^\s]*\s+)+/
  const match = cmd.match(envPrefixRegex)
  if (match) {
    return [match[0], cmd.slice(match[0].length).trim()]
  }
  return ["", cmd]
}

/**
 * Special case: head -N file → rtk read file --max-lines N
 */
function rewriteHeadNumeric(cmd: string, envPrefix: string): string | null {
  const headNRegex = /^head\s+-(\d+)\s+(.+)$/
  const headLinesRegex = /^head\s+--lines=(\d+)\s+(.+)$/
  
  let match = cmd.match(headNRegex)
  if (match) {
    return `${envPrefix}rtk read ${match[2]} --max-lines ${match[1]}`
  }
  
  match = cmd.match(headLinesRegex)
  if (match) {
    return `${envPrefix}rtk read ${match[2]} --max-lines ${match[1]}`
  }
  
  // head with other flags (e.g., -c): skip rewriting
  if (cmd.startsWith("head -")) {
    return null
  }
  
  return null
}

/**
 * Rewrite a single command segment
 */
function rewriteSegment(segment: string): string {
  const trimmed = segment.trim()
  
  if (!trimmed || shouldIgnore(trimmed)) {
    return segment
  }
  
  // Already RTK
  if (trimmed.startsWith("rtk ") || trimmed === "rtk") {
    return segment
  }
  
  // Extract env prefix (sudo, env VAR=val, etc.)
  const [envPrefix, cleanCmd] = extractEnvPrefix(trimmed)
  
  // Skip if RTK_DISABLED=1 in env prefix
  if (envPrefix.includes("RTK_DISABLED=")) {
    return segment
  }
  
  // Special case: head -N file
  if (cleanCmd.startsWith("head -")) {
    const specialRewrite = rewriteHeadNumeric(cleanCmd, envPrefix)
    if (specialRewrite !== null) {
      return specialRewrite
    }
  }
  
  // Skip gh with structured output flags
  if (cleanCmd.startsWith("gh ")) {
    const lowerCmd = cleanCmd.toLowerCase()
    if (lowerCmd.includes("--json") || lowerCmd.includes("--jq") || lowerCmd.includes("--template")) {
      return segment
    }
  }
  
  // Try each rewrite rule
  for (const [rtkCmd, prefixes] of REWRITE_RULES) {
    for (const prefix of prefixes) {
      const rest = stripWordPrefix(cleanCmd, prefix)
      if (rest !== null) {
        return rest ? `${envPrefix}${rtkCmd} ${rest}` : `${envPrefix}${rtkCmd}`
      }
    }
  }
  
  return segment
}

/**
 * Rewrite compound command (with &&, ||, ;, |)
 */
function rewriteCompound(cmd: string): string {
  const bytes = cmd.split("")
  const len = bytes.length
  let result = ""
  let anyChanged = false
  let segStart = 0
  let i = 0
  let inSingle = false
  let inDouble = false
  
  while (i < len) {
    const char = bytes[i]
    
    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      i++
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble
      i++
    } else if (char === "|" && !inSingle && !inDouble) {
      if (i + 1 < len && bytes[i + 1] === "|") {
        // || operator
        const seg = cmd.slice(segStart, i).trim()
        const rewritten = rewriteSegment(seg)
        if (rewritten !== seg) anyChanged = true
        result += rewritten + " || "
        i += 2
        while (i < len && bytes[i] === " ") i++
        segStart = i
      } else {
        // | pipe - rewrite first segment only, pass through rest
        const seg = cmd.slice(segStart, i).trim()
        const rewritten = rewriteSegment(seg)
        if (rewritten !== seg) anyChanged = true
        result += rewritten + " " + cmd.slice(i).trimStart()
        return anyChanged ? result : cmd
      }
    } else if (char === "&" && !inSingle && !inDouble) {
      if (i + 1 < len && bytes[i + 1] === "&") {
        // && operator
        const seg = cmd.slice(segStart, i).trim()
        const rewritten = rewriteSegment(seg)
        if (rewritten !== seg) anyChanged = true
        result += rewritten + " && "
        i += 2
        while (i < len && bytes[i] === " ") i++
        segStart = i
      } else if (i + 1 < len && bytes[i + 1] === ">") {
        // &> redirect
        i++
      } else if (i > 0 && bytes[i - 1] === ">") {
        // >& redirect
        i++
      } else {
        // & background operator
        const seg = cmd.slice(segStart, i).trim()
        const rewritten = rewriteSegment(seg)
        if (rewritten !== seg) anyChanged = true
        result += rewritten + " & "
        i++
        while (i < len && bytes[i] === " ") i++
        segStart = i
      }
    } else if (char === ";" && !inSingle && !inDouble) {
      const seg = cmd.slice(segStart, i).trim()
      const rewritten = rewriteSegment(seg)
      if (rewritten !== seg) anyChanged = true
      result += rewritten + ";"
      i++
      while (i < len && bytes[i] === " ") i++
      if (i < len) result += " "
      segStart = i
    } else {
      i++
    }
  }
  
  // Last segment
  const seg = cmd.slice(segStart).trim()
  const rewritten = rewriteSegment(seg)
  if (rewritten !== seg) anyChanged = true
  result += rewritten
  
  return anyChanged ? result : cmd
}

/**
 * Main rewrite entry point
 */
function rewriteCommand(cmd: string): string | null {
  const trimmed = cmd.trim()
  
  if (!trimmed) {
    return null
  }
  
  // Skip heredocs and arithmetic expansion
  if (trimmed.includes("<<") || trimmed.includes("$((")) {
    return null
  }
  
  // Simple already-RTK command
  const hasCompound = trimmed.includes("&&") || trimmed.includes("||") || 
                      trimmed.includes(";") || trimmed.includes("|") ||
                      trimmed.includes(" & ")
  
  if (!hasCompound && (trimmed.startsWith("rtk ") || trimmed === "rtk")) {
    return null
  }
  
  const rewritten = rewriteCompound(trimmed)
  return rewritten !== trimmed ? rewritten : null
}

// ============================================
// PLUGIN EXPORT
// ============================================

export const RtkRewrite: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") {
        return
      }
      
      const cmd = output.args.command
      const rewritten = rewriteCommand(cmd)
      
      if (rewritten) {
        output.args.command = rewritten
      }
    },
  }
}
