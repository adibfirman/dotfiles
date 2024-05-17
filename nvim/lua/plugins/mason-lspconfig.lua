return {
  "williamboman/mason.nvim",
  "williamboman/mason-lspconfig.nvim",
  init = function()
    require("mason-lspconfig").setup({
      ensure_installed = {
        "bash-language-server",
        "eslint-lsp",
        "json-lsp",
        "lua-language-server",
        "markdownlint",
        "marksman",
        "prettier",
        "prettierd",
        "rustywind",
        "shellcheck",
        "shfmt",
        "stylua",
        "tailwindcss-language-server",
        "typescript-language-server",
        "vetur-vls",
        "vue-language-server",
        "yaml-language-server",
      },
    })
  end,
}
