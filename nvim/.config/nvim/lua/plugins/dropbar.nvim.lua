return {
  "Bekaboo/dropbar.nvim",
  lazy = false,
  priority = 999,
  config = function()
    require("dropbar").setup({
      sources = {
        lsp = {
          max_depth = 1,
        },
      },
    })
  end,
}
