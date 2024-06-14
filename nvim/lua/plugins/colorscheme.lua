return {
  {
    "sainnhe/everforest",
    lazy = false,
    priority = 1000,
    config = function()
      vim.g.everforest_enable_italic = true
      vim.g.everforest_diagnostic_text_highlight = true
      vim.cmd.colorscheme("everforest")
    end,
  },
}
