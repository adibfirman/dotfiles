return {
  "folke/noice.nvim",
  event = "VeryLazy",
  version = "*",
  dependencies = {
    "MunifTanjim/nui.nvim",
    "rcarriga/nvim-notify",
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
      },
      presets = {
        bottom_search = true,
        command_palette = true,
        long_message_to_split = true,
        inc_rename = false,
        lsp_doc_border = false,
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
      },
      override = {
        ["vim.notify"] = true,
      },
    })
  end,
}
