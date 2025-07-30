return {
  "Bekaboo/dropbar.nvim",
  tags = "*",
  config = function()
    require("dropbar").setup({
      icons = {
        ui = {
          bar = {
            separator = " 󰿟 ",
          },
        },
      },
      sources = {
        treesitter = {
          max_depth = 3,
        },
      },
    })
  end,
}
