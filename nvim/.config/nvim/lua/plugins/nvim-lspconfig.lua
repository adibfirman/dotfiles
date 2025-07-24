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
    local lspconfig = require("lspconfig")
    local capabilities = require("blink.cmp").get_lsp_capabilities()

    vim.lsp.enable("astro", {
      filetypes = { "astro" },
      capabilities = capabilities,
    })

    vim.lsp.enable("lua_ls", {
      filetypes = { "lua" },
      format = true,
      capabilities = capabilities,
      root_dir = get_base_root_dir,
    })

    vim.lsp.enable("ts_ls", function()
      local data_path = vim.fn.stdpath("data")
      local vue_lsp_loc = data_path .. "/mason/packages/vue-language-server/node_modules/@vue/language-server"
      local format = { "javascript", "typescript", "vue", "typescriptreact", "javascriptreact" }

      lspconfig["ts_ls"].setup({
        capabilities = capabilities,
        root_dir = get_base_root_dir,
        init_options = {
          plugins = {
            {
              name = "@vue/typescript-plugin",
              location = vue_lsp_loc,
              languages = format,
            },
          },
        },
        filetypes = format,
      })
    end)

    vim.lsp.enable("jsonls", {
      capabilities = capabilities,
    })

    vim.lsp.enable("vue_ls", {
      filetypes = { "vue" },
      capabilities = capabilities,
    })
  end,
}
