import path from "node:path"

import type { AssistantMessage } from "@earendil-works/pi-ai"
import {
  CustomEditor,
  Theme,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent"
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui"

type GitStatus = {
  changedFiles?: number
}

type EditorPasteState = {
  pastes: Map<number, string>
  pasteCounter: number
}

const IMAGE_LABEL = "[Image]"
const PASTE_MARKER = /\[paste #(\d+) \d+ chars\]/g

const LARGE_LOGO = [
  "██████████    ████",
  "████    ████  ████",
  "████    ████  ████",
  "██████████    ████",
  "████          ████",
  "████          ████",
  "████          ████",
]

const DRACULA_THEME = new Theme(
  {
    accent: "#BD93F9",
    border: "#6272A4",
    borderAccent: "#FF79C6",
    borderMuted: "#44475A",
    success: "#50FA7B",
    error: "#FF5555",
    warning: "#F1FA8C",
    muted: "#6272A4",
    dim: "#6272A4",
    text: "#F8F8F2",
    thinkingText: "#6272A4",
    userMessageText: "#F8F8F2",
    customMessageText: "#F8F8F2",
    customMessageLabel: "#8BE9FD",
    toolTitle: "#BD93F9",
    toolOutput: "#F8F8F2",
    mdHeading: "#FF79C6",
    mdLink: "#8BE9FD",
    mdLinkUrl: "#6272A4",
    mdCode: "#50FA7B",
    mdCodeBlock: "#F8F8F2",
    mdCodeBlockBorder: "#44475A",
    mdQuote: "#F1FA8C",
    mdQuoteBorder: "#6272A4",
    mdHr: "#44475A",
    mdListBullet: "#8BE9FD",
    toolDiffAdded: "#50FA7B",
    toolDiffRemoved: "#FF5555",
    toolDiffContext: "#6272A4",
    syntaxComment: "#6272A4",
    syntaxKeyword: "#FF79C6",
    syntaxFunction: "#50FA7B",
    syntaxVariable: "#F8F8F2",
    syntaxString: "#F1FA8C",
    syntaxNumber: "#BD93F9",
    syntaxType: "#8BE9FD",
    syntaxOperator: "#FF79C6",
    syntaxPunctuation: "#F8F8F2",
    thinkingOff: "#6272A4",
    thinkingMinimal: "#6272A4",
    thinkingLow: "#8BE9FD",
    thinkingMedium: "#50FA7B",
    thinkingHigh: "#F1FA8C",
    thinkingXhigh: "#FFB86C",
    thinkingMax: "#FF5555",
    bashMode: "#50FA7B",
  },
  {
    selectedBg: "#44475A",
    userMessageBg: "#44475A",
    customMessageBg: "#282A36",
    toolPendingBg: "#282A36",
    toolSuccessBg: "#44475A",
    toolErrorBg: "#44475A",
  },
  "truecolor",
  { name: "dracula" },
)

function formatPath(filePath: string, cwd: string): string {
  const home = process.env.HOME
  if (home && (filePath === home || filePath.startsWith(`${home}${path.sep}`))) {
    return `~${filePath.slice(home.length)}`
  }

  const relative = path.relative(cwd, filePath)
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `.${path.sep}${relative}`
  }

  return filePath
}

function gradientLogoLine(line: string, theme: ExtensionContext["ui"]["theme"]): string {
  const blocks = [...line].filter((character) => character !== " ").length
  let blockIndex = 0

  return [...line]
    .map((character) => {
      if (character === " ") return character

      const progress = blocks <= 1 ? 0 : blockIndex / (blocks - 1)
      blockIndex += 1
      if (progress < 1 / 3) return theme.fg("accent", character)
      if (progress < 2 / 3) return theme.fg("mdHeading", character)
      return theme.fg("mdLink", character)
    })
    .join("")
}

function center(line: string, width: number): string {
  const padding = Math.max(0, Math.floor((width - visibleWidth(line)) / 2))
  return `${" ".repeat(padding)}${line}`
}

function renderHeader(
  width: number,
  cwd: string,
  theme: ExtensionContext["ui"]["theme"],
): string[] {
  const lines: string[] = [""]
  if (width >= 64) {
    lines.push(...LARGE_LOGO.map((line) => center(gradientLogoLine(line, theme), width)))
    lines.push(center(theme.fg("accent", formatPath(cwd, cwd)), width), "", "")
  } else {
    lines.push(center(`${theme.fg("accent", "PI")} ${theme.fg("muted", formatPath(cwd, cwd))}`, width), "")
  }

  while (lines.at(-1) === "") lines.pop()
  return lines
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

function formatContextUsage(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage()
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow
  if (!contextWindow) return "-%/-"
  return `${usage?.percent === null || usage?.percent === undefined ? "-" : Math.round(usage.percent)}%/${formatTokens(contextWindow)}`
}

function sessionCost(ctx: ExtensionContext): number {
  let cost = 0
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += (entry.message as AssistantMessage).usage.cost.total
    }
  }
  return cost
}

function alignSides(left: string, right: string, width: number): string {
  if (!right) return truncateToWidth(left, width)
  if (!left) return truncateToWidth(right, width)

  const gap = width - visibleWidth(left) - visibleWidth(right)
  if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`

  const available = Math.max(1, width - 1)
  const leftWidth = Math.max(1, Math.floor(available * 0.45))
  const rightWidth = Math.max(1, available - leftWidth)
  return `${truncateToWidth(left, leftWidth)} ${truncateToWidth(right, rightWidth)}`
}

function changedFileCount(output: string): number {
  const entries = output.split("\0")
  let count = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue

    count += 1
    if (/[RC]/.test(entry.slice(0, 2))) index += 1
  }

  return count
}

function isClipboardImagePath(value: string | undefined): value is string {
  return value !== undefined && path.basename(value).startsWith("pi-clipboard-")
}

export default function uiCustomization(pi: ExtensionAPI) {
  let activeTui: TUI | undefined
  let gitStatus: GitStatus = {}
  let latestTokensPerSecond: number | undefined
  let generationStartedAt: number | undefined
  let gitRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let sessionGeneration = 0

  const requestRender = () => activeTui?.requestRender()

  const refreshGit = async (ctx: ExtensionContext, generation: number) => {
    const result = await pi
      .exec("git", ["status", "--porcelain=v1", "-z"], { cwd: ctx.cwd })
      .catch(() => undefined)

    if (generation !== sessionGeneration) return
    gitStatus = result?.code === 0 ? { changedFiles: changedFileCount(result.stdout) } : {}
    requestRender()
  }

  const scheduleGitRefresh = (ctx: ExtensionContext, delay = 150) => {
    if (gitRefreshTimer) clearTimeout(gitRefreshTimer)
    const generation = sessionGeneration
    gitRefreshTimer = setTimeout(() => void refreshGit(ctx, generation), delay)
  }

  pi.on("agent_start", () => {
    generationStartedAt = performance.now()
  })

  pi.on("agent_end", (event) => {
    if (generationStartedAt !== undefined) {
      const outputTokens = event.messages.reduce((total, message) => {
        return message.role === "assistant" ? total + message.usage.output : total
      }, 0)
      const elapsedSeconds = (performance.now() - generationStartedAt) / 1000
      latestTokensPerSecond = outputTokens > 0 && elapsedSeconds > 0 ? outputTokens / elapsedSeconds : undefined
    }
    generationStartedAt = undefined
    requestRender()
  })

  pi.on("model_select", () => {
    latestTokensPerSecond = undefined
    requestRender()
  })

  pi.on("thinking_level_select", requestRender)

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName === "bash" || event.toolName === "edit" || event.toolName === "write") {
      scheduleGitRefresh(ctx)
    }
  })

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return

    ctx.ui.setTheme(DRACULA_THEME)
    sessionGeneration += 1
    gitStatus = {}
    latestTokensPerSecond = undefined

    ctx.ui.setHeader((tui, theme) => {
      activeTui = tui
      return {
        render: (width) => renderHeader(width, ctx.cwd, theme),
        invalidate() {},
      }
    })

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui
      const unsubscribe = footerData.onBranchChange(() => {
        scheduleGitRefresh(ctx, 0)
        tui.requestRender()
      })

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const model = ctx.model
            ? width >= 72
              ? `${ctx.model.provider}/${ctx.model.id}`
              : ctx.model.id
            : "no model"
          const modelStatus = theme.fg("muted", `${model} · ${pi.getThinkingLevel()}`)
          const cwd = theme.fg("text", formatPath(ctx.cwd, ctx.cwd))
          const metrics = [
            formatContextUsage(ctx),
            ...(width >= 48 ? [`$${sessionCost(ctx).toFixed(2)}`] : []),
            ...(width >= 72 ? [`${latestTokensPerSecond?.toFixed(1) ?? "-"} tok/s`] : []),
          ].join(" · ")
          const branch = footerData.getGitBranch()
          const git = branch
            ? width >= 72 && gitStatus.changedFiles !== undefined
              ? `${branch} · ${gitStatus.changedFiles} ${gitStatus.changedFiles === 1 ? "file" : "files"} changed`
              : branch
            : ""

          return [
            alignSides(cwd, modelStatus, width),
            alignSides(theme.fg("muted", metrics), theme.fg("muted", git), width),
          ]
        },
      }
    })

    class DraculaEditor extends CustomEditor {
      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings)
        activeTui = tui
      }

      override insertTextAtCursor(text: string): void {
        if (!isClipboardImagePath(text)) {
          super.insertTextAtCursor(text)
          return
        }

        const pasteState = this as unknown as EditorPasteState
        const pasteId = ++pasteState.pasteCounter
        pasteState.pastes.set(pasteId, text)
        super.insertTextAtCursor(`[paste #${pasteId} ${text.length} chars]`)
      }

      override render(width: number): string[] {
        const lines = super.render(width)
        if (lines.length >= 2) {
          const border = this.borderColor("─".repeat(Math.max(0, width)))
          lines[0] = border
          lines[lines.length - 1] = border
        }

        const { pastes } = this as unknown as EditorPasteState
        return lines.map((line) =>
          line.replace(PASTE_MARKER, (marker, id: string) => {
            if (!isClipboardImagePath(pastes.get(Number(id)))) return marker
            return `${IMAGE_LABEL}${" ".repeat(marker.length - IMAGE_LABEL.length)}`
          }),
        )
      }
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new DraculaEditor(tui, theme, keybindings))
    scheduleGitRefresh(ctx, 0)
  })

  pi.on("session_shutdown", () => {
    sessionGeneration += 1
    if (gitRefreshTimer) clearTimeout(gitRefreshTimer)
    gitRefreshTimer = undefined
    activeTui = undefined
  })
}
