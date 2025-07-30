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
        kinds = {
          dir_icon = "",
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
