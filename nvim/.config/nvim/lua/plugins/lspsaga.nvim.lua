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
        virtual_text = false,
      },
      symbol_in_winbar = {
        enable = false,
      },
    })
  end,
}
