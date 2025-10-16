return {
  "folke/snacks.nvim",
  priority = 1000,
  lazy = false,
  version = "*",
  config = function()
    require("snacks").setup({
      lazygit = {
        theme = {
          selectedLineBgColor = { bg = "CursorLine" },
        },
        win = {
          width = 0,
          height = 0,
        },
      },
      scope = { enabled = true },
      indent = { enabled = true },
      picker = {
        debug = {
          scores = false, -- show scores in the list
        },
        layout = {
          preset = "ivy",
          cycle = false,
        },
        layouts = {
          ivy = {
            layout = {
              box = "vertical",
              backdrop = false,
              row = -1,
              width = 0,
              height = 0.5,
              border = "top",
              title = " {title} {live} {flags}",
              title_pos = "left",
              { win = "input", height = 1, border = "bottom" },
              {
                box = "horizontal",
                { win = "list", border = "none" },
                { win = "preview", title = "{preview}", width = 0.5, border = "left" },
              },
            },
          },
          vertical = {
            layout = {
              backdrop = false,
              width = 0.8,
              min_width = 80,
              height = 0.8,
              min_height = 30,
              box = "vertical",
              border = "rounded",
              title = "{title} {live} {flags}",
              title_pos = "center",
              { win = "input", height = 1, border = "bottom" },
              { win = "list", border = "none" },
              { win = "preview", title = "{preview}", height = 0.4, border = "top" },
            },
          },
        },
        matcher = {
          frecency = true,
        },
        win = {
          input = {
            keys = {
              -- to close the picker on ESC instead of going to normal mode,
              -- add the following keymap to your config
              -- ["<Esc>"] = { "close", mode = { "n", "i" } },
              -- I'm used to scrolling like this in LazyGit
              ["J"] = { "preview_scroll_down", mode = { "i", "n" } },
              ["K"] = { "preview_scroll_up", mode = { "i", "n" } },
              ["H"] = { "preview_scroll_left", mode = { "i", "n" } },
              ["L"] = { "preview_scroll_right", mode = { "i", "n" } },
            },
          },
        },
        formatters = {
          file = {
            filename_first = true, -- display filename before the file path
            truncate = 80,
          },
        },
      },
      notifier = {
        enabled = true,
        top_down = true,
      },
      styles = {
        snacks_image = {
          relative = "editor",
          col = -1,
        },
      },
      image = {
        enabled = true,
        doc = {
          inline = false,
          float = true,
          max_width = 60,
          max_height = 30,
        },
      },
      zen = {
        enabled = true,
        toggles = {
          dim = false,
          git_signs = true,
          mini_diff_signs = true,
          diagnostics = true,
          inlay_hints = true,
        },
        show = {
          statusline = true,
          tabline = true,
        },
        win = {
          backdrop = {
            transparent = false,
            blend = 99,
          },
        },
      },
      dashboard = {
        enabled = true,
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
    })
  end,
}
