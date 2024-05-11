return {
  -- {
  --   "folke/tokyonight.nvim",
  --   disabled = true,
  --   opts = {
  --     transparent = true,
  --     styles = {
  --       sidebars = "transparent",
  --       floats = "transparent",
  --     },
  --   },
  -- },

  -- {
  --
  --   "scottmckendry/cyberdream.nvim",
  --   disabled = true,
  --   lazy = false,
  --   priority = 1000,
  --   config = function()
  --     require("cyberdream").setup({
  --       -- Recommended - see "Configuring" below for more config options
  --       transparent = true,
  --       italic_comments = true,
  --       hide_fillchars = true,
  --       borderless_telescope = true,
  --       terminal_colors = true,
  --     })
  --
  --     vim.cmd("colorscheme cyberdream") -- set the colorscheme
  --   end,
  -- },

  {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
      require("catppuccin").setup({
        transparent_background = true,
        term_colors = true,
        color_overrides = {
          all = {
            text = "#ffffff",
          },
          mocha = {
            base = "#1e1e2e",
          },
          frappe = {},
          macchiato = {},
          latte = {},
        },
      })
    end,
  },

  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "catppuccin",
    },
  },
}
