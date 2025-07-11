return {
  "nvim-treesitter/nvim-treesitter",
  dependencies = {
    "williamboman/mason.nvim",
  },
  build = ":TSUpdate",
  event = "VeryLazy",
  config = function()
    require("nvim-treesitter.configs").setup({
      ensure_installed = {
        "astro",
        "bash",
        "c",
        "css",
        "dockerfile",
        "fish",
        "go",
        "graphql",
        "html",
        "java",
        "javascript",
        "json",
        "latex",
        "lua",
        "luadoc",
        "luap",
        "markdown",
        "markdown_inline",
        "nix",
        "norg",
        "python",
        "query",
        "regex",
        "ruby",
        "rust",
        "scss",
        "svelte",
        "tsx",
        "typescript",
        "typst",
        "vim",
        "vimdoc",
        "vue",
        "yaml",
      },
      sync_install = true,
      highlight = { enable = true },
      indent = { enable = true },
      -- Automatically install missing parsers when entering buffer
      -- Recommendation: set to false if you don't have `tree-sitter` CLI installed locally
      auto_install = false,
      ignore_install = {},
    })
  end,
}
