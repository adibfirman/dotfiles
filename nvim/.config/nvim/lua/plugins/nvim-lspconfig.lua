local get_base_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

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

    local astro = {
      filetypes = { "astro" },
      capabilities = capabilities,
    }

    local lua_ls = {
      filetypes = { "lua" },
      format = true,
      capabilities = capabilities,
      root_dir = get_base_root_dir,
    }

    local ts_ls = {
      capabilities = capabilities,
      root_dir = get_base_root_dir,
    }

    local jsonls = {
      capabilities = capabilities,
    }

    vim.lsp.enable("astro", astro)
    vim.lsp.enable("jsonls", jsonls)
    vim.lsp.enable("lua_ls", lua_ls)
    vim.lsp.enable("ts_ls", ts_ls)
    vim.lsp.enable("vtsls")
    vim.lsp.enable("vue_ls")
  end,
}
