return {
  "saghen/blink.cmp",
  dependencies = {
    "rafamadriz/friendly-snippets",
    "folke/lazydev.nvim",
    {
      "saghen/blink.compat",
      version = "2.*", -- use v2.* for blink.cmp v1.*
      lazy = true,
      opts = {
        debug = false,
      },
    },
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
      snippets = { preset = "default" },
      completion = {
        menu = {
          auto_show = function(ctx)
            return ctx.mode ~= "cmdline" or not vim.tbl_contains({ "/", "?" }, vim.fn.getcmdtype())
          end,
        },
        documentation = { auto_show = true },
        ghost_text = { enabled = true },
      },
      fuzzy = {
        implementation = "prefer_rust_with_warning",
        use_frecency = true,
        use_proximity = true,
      },
      sources = {
        default = { "lsp", "path", "snippets", "lazydev", "buffer", "omni" },
        providers = {
          lazydev = { module = "lazydev.integrations.blink", score_offset = 100 },
        },
        min_keyword_length = function(ctx)
          if ctx.mode == "cmdline" and string.find(ctx.line, " ") == nil then
            return 3
          end
          return 0
        end,
      },
    })
  end,
}
