return {
  "nvimdev/lspsaga.nvim",
  event = "LspAttach",
  branch = "main",
  dependencies = {
    "nvim-treesitter/nvim-treesitter",
    "nvim-tree/nvim-web-devicons",
  },
  config = function()
    require("lspsaga").setup({
      lightbulb = {
        enabled = false,
        sign = false,
      },
      symbol_in_winbar = {
        enable = true,
        hide_keyword = true,
      },
    })
  end,
}
