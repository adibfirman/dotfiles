local get_base_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

return {
  {
    "zeioth/garbage-day.nvim",
    dependencies = "neovim/nvim-lspconfig",
    event = "VeryLazy",
    opts = {},
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
    "williamboman/mason.nvim",
    cmd = "Mason",
    build = ":MasonUpdate",
    opts_extend = { "ensure_installed" },
    opts = {
      ensure_installed = {
        "ast-grep",
        "eslint-lsp",
        "eslint_d",
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
    "zapling/mason-lock.nvim",
    init = function()
      require("mason-lock").setup({
        lockfile_path = vim.fn.stdpath("config") .. "/mason-lock.json",
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
          javascript = { "prettier", stop_after_first = true },
          typescript = { "prettier", stop_after_first = true },
          javascriptreact = { "prettier", stop_after_first = true },
          typescriptreact = { "prettier", stop_after_first = true },
          svelte = { "prettier", stop_after_first = true },
          css = { "prettier", stop_after_first = true },
          html = { "prettier", stop_after_first = true },
          markdown = { "prettier", stop_after_first = true },
          graphql = { "prettier", stop_after_first = true },
        },
        format_on_save = {
          timeout_ms = 500,
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
        ["eslint"] = function()
          lspconfig["eslint"].setup({
            root_dir = get_base_root_dir,
            capabilities = capabilities,
            format = true,
            on_attach = function(_, bufnr)
              vim.api.nvim_create_autocmd("BufWritePre", {
                buffer = bufnr,
                command = "EslintFixAll",
              })
            end,
          })
        end,
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({
            filetypes = { "lua" },
            format = true,
            capabilities = capabilities,
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
