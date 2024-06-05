-- return {
--   {
--     "catppuccin/nvim",
--     name = "catppuccin",
--     priority = 1000,
--     config = function()
--       require("catppuccin").setup({
--         transparent_background = true,
--         term_colors = true,
--         color_overrides = {
--           all = {
--             text = "#ffffff",
--           },
--           mocha = {
--             base = "#1e1e2e",
--           },
--           frappe = {},
--           macchiato = {},
--           latte = {},
--         },
--       })
--     end,
--   },
--
--   {
--     "LazyVim/LazyVim",
--     opts = {
--       colorscheme = "catppuccin",
--     },
--   },
-- }

return {
  {
    "rose-pine/neovim",
    name = "rose-pine",
  },
  {
    "LazyVim/LazyVim",
    opts = {
      colorscheme = "rose-pine-dawn",
    },
  },
}
