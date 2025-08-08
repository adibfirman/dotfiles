return {
  "neovim/nvim-lspconfig",
  version = "*",
  dependencies = {
    "williamboman/mason.nvim",
    "williamboman/mason-lspconfig.nvim",
    "saghen/blink.cmp",
  },
  config = function()
    local capabilities = require("blink.cmp").get_lsp_capabilities()

    vim.lsp.config("*", {
      capabilities = capabilities,
    })

    local list_lsp = {
      "astro",
      "css_variables",
      "cssls",
      "eslint",
      "gopls",
      "harper_ls",
      "jsonls",
      "lua_ls",
      "quick_lint_js",
      "stylelint_lsp",
      "ts_ls",
      "vtsls",
      "vue_ls",
    }

    for _, v in ipairs(list_lsp) do
      vim.lsp.enable(v)
    end
  end,
}
