return {
  "nvim-lualine/lualine.nvim",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  event = "VeryLazy",
  config = function()
    vim.api.nvim_set_hl(0, "StatusLine", { bg = nil })

    -- ----- reference position ------
    -- +-------------------------------------------------+
    -- | A | B | C                             X | Y | Z |
    -- +-------------------------------------------------+
    require("lualine").setup({
      options = {
        theme = "iceberg_dark",
        component_separators = "",
        section_separators = { left = "", right = "" },
        disabled_filetypes = { "alpha", "Outline" },
      },
      sections = {
        lualine_a = {
          { "mode", separator = { left = " ", right = "" }, icon = "" },
        },
        lualine_b = {
          -- {
          --   "filetype",
          --   icon_only = true,
          --   padding = { left = 1, right = 0 },
          -- },
          "filename",
        },
        lualine_c = {
          {
            "branch",
            icon = "",
          },
          {
            "diff",
            symbols = { added = " ", modified = " ", removed = " " },
            colored = false,
          },
        },
        lualine_x = {
          {
            "diagnostics",
            symbols = { error = " ", warn = " ", info = " ", hint = " " },
            update_in_insert = true,
          },
        },
        lualine_y = { "lsp_status" },
        lualine_z = {
          { "location", separator = { left = "", right = " " }, icon = "" },
        },
      },
      inactive_sections = {
        lualine_a = { "filename" },
        lualine_b = {},
        lualine_c = {},
        lualine_x = {},
        lualine_y = {},
        lualine_z = { "location" },
      },
      extensions = { "toggleterm", "trouble" },
    })
  end,
}
