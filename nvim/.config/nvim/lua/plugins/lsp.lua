local get_base_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

return {
  {
    "ray-x/lsp_signature.nvim",
    event = "VeryLazy",
    config = function()
      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(args)
          local bufnr = args.buf
          require("lsp_signature").on_attach({
            bind = false,
            floating_window = false,
            hint_prefix = {
              above = "↙ ", -- when the hint is on the line above the current line
              current = "← ", -- when the hint is on the same line
              below = "↖ ", -- when the hint is on the line below the current line
            },
            handler_opts = {
              border = "rounded",
            },
          }, bufnr)
        end,
      })
    end,
  },
  {
    "L3MON4D3/LuaSnip",
    dependencies = { "rafamadriz/friendly-snippets", "saadparwaiz1/cmp_luasnip" },
  },
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
    "hrsh7th/nvim-cmp",
    event = { "InsertEnter", "CmdlineEnter" },
    dependencies = {
      "onsails/lspkind.nvim",
      "hrsh7th/cmp-nvim-lsp",
    },
    config = function()
      local cmp = require("cmp")
      local defaults = require("cmp.config.default")()
      require("luasnip.loaders.from_vscode").lazy_load()

      cmp.setup({
        snippet = {
          expand = function(args)
            require("luasnip").lsp_expand(args.body)
            vim.snippet.expand(args.body)
          end,
        },
        window = {
          completion = {
            winhighlight = "Normal:Pmenu,FloatBorder:Pmenu,Search:None",
            col_offset = -3,
            side_padding = 0,
            autocomplete = false,
            completeopt = "menu,menuone",
          },
          documentation = {
            winhighlight = "Normal:FloatBorder,FloatBorder:FloatBorder,Search:None",
          },
        },
        formatting = {
          fields = { "kind", "abbr", "menu" },
          format = function(entry, vim_item)
            local kind = require("lspkind").cmp_format({ mode = "symbol_text", maxwidth = 50 })(entry, vim_item)
            local strings = vim.split(kind.kind, "%s", { trimempty = true })
            kind.kind = " " .. (strings[1] or "") .. " "
            kind.menu = "    (" .. (strings[2] or "") .. ")"

            return kind
          end,
        },
        mapping = {
          ["<Tab>"] = cmp.mapping.select_next_item(),
          ["<S-Tab>"] = cmp.mapping.select_prev_item(),
          ["<CR>"] = cmp.mapping.confirm({ behavior = cmp.ConfirmBehavior.Replace, select = true }),
        },
        sorting = defaults.sorting,
        -- the orders below are matters
        sources = cmp.config.sources({
          { name = "nvim_lsp" },
          { name = "nvim_lsp_signature_help" },
          { name = "path" },
          { name = "luasnip" },
        }, { name = "buffer" }),
      })
    end,
  },
  {
    "nvim-treesitter/nvim-treesitter",
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
    "williamboman/mason-lspconfig.nvim",
    lazy = false,
    dependencies = {
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
    },
    config = function()
      require("mason-lspconfig").setup({
        automatic_installation = true,
      })
    end,
  },
  {
    "zapling/mason-lock.nvim",
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
        lua = { "luacheck" },
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
    cmd = { "ConformInfo" },
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
    },
    config = function()
      local lspconfig = require("lspconfig")
      local mason_lspconfig = require("mason-lspconfig")
      local cmp_nvim_lsp = require("cmp_nvim_lsp")
      local capabilities = cmp_nvim_lsp.default_capabilities()

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
