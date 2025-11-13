return {
  "chrisgrieser/nvim-chainsaw",
  event = "VeryLazy",
  config = function()
    require("chainsaw").setup({
      visuals = {
        icon = false,
      },
    })
  end,
}
