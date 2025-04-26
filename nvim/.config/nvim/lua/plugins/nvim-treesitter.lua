return {
  "nvim-treesitter/nvim-treesitter",
  dependencies = {
    "williamboman/mason.nvim",
  },
  build = ":TSUpdate",
  event = "VeryLazy",
  setup = function()
    require("nvim-treesitter.configs").setup({
      highlight = { enable = true },
      indent = { enable = true },
      auto_install = true,
    })
  end,
}
