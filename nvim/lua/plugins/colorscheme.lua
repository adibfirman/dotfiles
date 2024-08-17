return {
  {
    "lalitmee/cobalt2.nvim",
    event = { "ColorSchemePre" },
    dependencies = { "tjdevries/colorbuddy.nvim", tag = "v1.0.0" },
    init = function()
      require("colorbuddy").colorscheme("cobalt2")
    end,
  },
}
-- return {
--   "tokyonight.nvim",
--   lazy = true,
--   opts = {
--     transparent = true,
--     styles = {
--       sidebars = "transparent",
--       floats = "transparent",
--     },
--   },
-- }
