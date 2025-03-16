local get_base_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

return {
  {
    "nvimdev/lspsaga.nvim",
    event = "LspAttach",
    dependencies = {
      "nvim-treesitter/nvim-treesitter",
      "nvim-tree/nvim-web-devicons",
    },
    config = function()
      require("lspsaga").setup({
        symbol_in_winbar = {
          enable = false,
        },
        lightbulb = {
          sign = false,
        },
      })
    end,
  },
  {
    "saghen/blink.cmp",
    dependencies = {
      "rafamadriz/friendly-snippets",
    },
    version = "*",
    config = function()
      require("blink.cmp").setup({
        keymap = {
          preset = "none",
          ["<S-Tab>"] = { "select_prev", "fallback" },
          ["<Tab>"] = { "select_next", "fallback" },
          ["<CR>"] = { "accept", "fallback" },
        },
        appearance = {
          use_nvim_cmp_as_default = true,
          nerd_font_variant = "mono",
        },
        signature = { enabled = true },
        snippets = { preset = "default" },
        completion = {
          menu = {
            auto_show = function(ctx)
              return ctx.mode ~= "cmdline" or not vim.tbl_contains({ "/", "?" }, vim.fn.getcmdtype())
            end,
          },
          documentation = {
            auto_show = true,
          },
        },
        sources = {
          default = { "lsp", "path", "snippets", "buffer", "omni", "cmdline" },
          min_keyword_length = function(ctx)
            if ctx.mode == "cmdline" and string.find(ctx.line, " ") == nil then
              return 3
            end
            return 0
          end,
        },
      })
    end,
  },
  {
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
  },
  {
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
  },
  {
    "williamboman/mason-lspconfig.nvim",
    lazy = false,
    dependencies = {
      "williamboman/mason.nvim",
    },
    config = function()
      require("mason-lspconfig").setup({
        automatic_installation = true,
      })
    end,
  },
  {
    "zapling/mason-lock.nvim",
    dependencies = {
      "williamboman/mason.nvim",
    },
    init = function()
      require("mason-lock").setup({
        lockfile_path = vim.fn.stdpath("config") .. "/mason-lock.json",
      })
    end,
  },
  {
    "mfussenegger/nvim-lint",
    config = function()
      local lint = require("lint")
      lint.linters_by_ft = {
        javascript = { "quick-lint-js" },
        typescript = { "quick-lint-js" },
        javascriptreact = { "quick-lint-js" },
        typescriptreact = { "quick-lint-js" },
        svelte = { "quick-lint-js" },
        css = { "quick-lint-js" },
        html = { "quick-lint-js" },
        markdown = { "quick-lint-js" },
        graphql = { "quick-lint-js" },
        vue = { "quick-lint-js" },
      }

      local lint_group = vim.api.nvim_create_augroup("list", { clear = true })
      vim.api.nvim_create_autocmd({ "BufWritePost", "BufRead" }, {
        group = lint_group,
        callback = function()
          require("lint").try_lint(nil, { ignore_errors = true })
        end,
      })
    end,
  },
  {
    "stevearc/conform.nvim",
    event = { "BufWritePre" },
    dependencies = { "mason.nvim" },
    lazy = true,
    cmd = "ConformInfo",
    config = function()
      require("conform").setup({
        formatters_by_ft = {
          lua = { "stylua" },
          javascript = { "prettierd", "prettier", stop_after_first = true },
          typescript = { "prettierd", "prettier", stop_after_first = true },
          javascriptreact = { "prettierd", "prettier", stop_after_first = true },
          typescriptreact = { "prettierd", "prettier", stop_after_first = true },
          svelte = { "prettierd", "prettier", stop_after_first = true },
          css = { "prettierd", "prettier", stop_after_first = true },
          html = { "prettierd", "prettier", stop_after_first = true },
          markdown = { "prettierd", "prettier", stop_after_first = true },
          graphql = { "prettierd", "prettier", stop_after_first = true },
          vue = { "prettierd", "prettier", stop_after_first = true },
        },
        format_on_save = {
          async = false,
          lsp_format = "fallback",
        },
      })
    end,
  },
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
      "saghen/blink.cmp",
    },
    config = function()
      local lspconfig = require("lspconfig")
      local mason_lspconfig = require("mason-lspconfig")
      local capabilities = require("blink.cmp").get_lsp_capabilities()

      mason_lspconfig.setup_handlers({
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({
            filetypes = { "lua" },
            format = true,
            capabilities = capabilities,
            root_dir = get_base_root_dir,
          })
        end,
        ["ts_ls"] = function()
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
        end,
        ["jsonls"] = function()
          lspconfig["jsonls"].setup({
            capabilities = capabilities,
          })
        end,
        ["vuels"] = function()
          lspconfig["vuels"].setup({
            filetypes = { "vue" },
            capabilities = capabilities,
          })
        end,
      })
    end,
  },
}
