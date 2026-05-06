import type { Plugin } from "@opencode-ai/plugin"
import { fileURLToPath } from "node:url"

const SOUND_PATH = fileURLToPath(new URL("../sounds/fahhh.mp3", import.meta.url))

export const NotifyOnIdle: Plugin = async ({ $, client }) => {
  const isMainSession = async (sessionID: string) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } })
      const session = result.data ?? result
      return !session.parentID
    } catch {
      return true
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return

      const sessionID = event.properties.sessionID
      if (!(await isMainSession(sessionID))) return

      await $`afplay ${SOUND_PATH}`
    },
  }
}
