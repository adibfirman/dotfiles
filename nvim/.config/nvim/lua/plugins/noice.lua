return {
  "folke/noice.nvim",
  event = "VeryLazy",
  version = "*",
  dependencies = {
    "MunifTanjim/nui.nvim",
    -- "rcarriga/nvim-notify",
  },
  config = function()
    require("noice").setup({
      lsp = {
        override = {
          ["vim.lsp.util.convert_input_to_markdown_lines"] = true,
          ["vim.lsp.util.stylize_markdown"] = true,
        },
        progress = {
          enabled = false,
        },
        hover = {
          enabled = false,
        },
      },
      presets = {
        bottom_search = true,
        long_message_to_split = true,
        inc_rename = false,
        lsp_doc_border = false,
        command_palette = {
          views = {
            cmdline_popup = {
              position = {
                row = "50%",
                col = "50%",
              },
              size = {
                min_width = 60,
                width = "auto",
                height = "auto",
              },
            },
            cmdline_popupmenu = {
              position = {
                row = "67%",
                col = "50%",
              },
            },
          },
        },
      },
      routes = {
        {
          filter = {
            event = "msg_show",
            any = {
              { find = "before #%d+" },
              { find = "after #%d+" },
            },
          },
          opts = { skip = true },
        },
        -- Suppress Tailwind hover "no info"
        {
          filter = {
            event = "notify",
            find = "No information available",
          },
          opts = { skip = true },
        },
        -- Optionally suppress other unwanted hover spam
        {
          filter = {
            event = "lsp",
            kind = "hover",
            find = "no hover information",
          },
          opts = { skip = true },
        },
      },
      -- override = {
      --   ["vim.notify"] = true,
      -- },
    })
  end,
}
