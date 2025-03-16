return {
  "nvim-focus/focus.nvim",
  version = "*",
  config = function()
    require("focus").setup({
      enable = true,
      autoresize = {
        minwidth = 10,
      },
    })
  end,
}
