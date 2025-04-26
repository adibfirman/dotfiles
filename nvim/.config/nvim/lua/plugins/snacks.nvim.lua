return {
  "folke/snacks.nvim",
  lazy = false,
  priority = 1000,
  opts = {
    lazygit = { enabled = true },
    scope = {},
    indent = {},
    zoom = {},
    notifier = {},
    dashboard = {
      width = 72,
      sections = {
        {
          section = "terminal",
          align = "center",
          cmd = "curl -s 'https://wttr.in/Jakarta?0'",
          height = 8,
          width = 72,
          padding = 1,
        },
        {
          align = "center",
          padding = 1,
          text = {
            { "  Update ", hl = "Label" },
            { "  Sessions ", hl = "@property" },
            { "  Last Session ", hl = "Number" },
            { "  Files ", hl = "DiagnosticInfo" },
            { "  Recent ", hl = "@string" },
          },
        },
        { section = "startup", padding = 1 },
        { icon = "󰏓 ", title = "Projects", section = "projects", indent = 2, padding = 1 },
        { icon = " ", title = "Recent Files", section = "recent_files", indent = 2, padding = 1 },
        { text = "", action = ":Lazy update", key = "u" },
        { text = "", action = ":PersistenceLoadSession", key = "s" },
        { text = "", action = ":PersistenceLoadLast", key = "l" },
      },
    },
  },
}
