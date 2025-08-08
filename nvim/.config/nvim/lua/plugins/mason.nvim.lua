return {
  "williamboman/mason.nvim",
  cmd = "Mason",
  build = ":MasonUpdate",
  version = "*",
  opts_extend = { "ensure_installed" },
  opts = {
    ensure_installed = {
      "ast-grep",
      "astro-language-server",
      "css-lsp",
      "css-variables-language-server",
      "eslint-lsp",
      "gofumpt",
      "goimports",
      "golangci-lint",
      "gopls",
      "harper-ls",
      "json-lsp",
      "lua-language-server",
      "luacheck",
      "luaformatter",
      "prettier",
      "prettierd",
      "quick-lint-js",
      "stylelint",
      "stylelint-lsp",
      "stylua",
      "typescript-language-server",
      "vetur-vls",
      "vue-language-server",
    },
  },
  config = function(_, opts)
    require("mason").setup(opts)
    local mr = require("mason-registry")

    mr:on("package:install:success", function()
      vim.defer_fn(function()
        require("lazy.core.handler.event").trigger({
          event = "FileType",
          buf = vim.api.nvim_get_current_buf(),
        })
      end, 100)
    end)

    -- Ensure installed all the package from options "opts.ensure_installed"
    mr.refresh(function()
      for _, tool in ipairs(opts.ensure_installed) do
        local p = mr.get_package(tool)
        if not p:is_installed() then
          p:install()
        end
      end
    end)
  end,
}
