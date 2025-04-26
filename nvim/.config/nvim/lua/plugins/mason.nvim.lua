return {
  "williamboman/mason.nvim",
  cmd = "Mason",
  build = ":MasonUpdate",
  opts_extend = { "ensure_installed" },
  opts = {
    ensure_installed = {
      "ast-grep",
      "eslint-lsp",
      "quick-lint-js",
      "harper-ls",
      "lua-language-server",
      "luacheck",
      "luaformatter",
      "prettier",
      "stylua",
      "typescript-language-server",
      "vue-language-server",
      "vetur-vls",
      "json-lsp",
      "prettierd",
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

    -- ensure installed all the package from options "opts.ensure_installed"
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
