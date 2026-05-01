import type { Plugin } from "@opencode-ai/plugin"
import { fileURLToPath } from "node:url"

const SOUND_PATH = fileURLToPath(new URL("../../dragon-studio-sword-clashhit.mp3", import.meta.url))

export const NotifyOnIdle: Plugin = async ({ $ }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      try {
        await $`printf '\033]9;opencode session completed\033\\' > /dev/tty`
      } catch {}

      try {
        await $`afplay ${SOUND_PATH}`
      } catch {}
    },
  }
}
