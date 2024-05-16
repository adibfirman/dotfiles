return {
  "rcarriga/nvim-notify",
  config = function()
    require("notify").setup({
      background_colour = "NotifyBackground",
      minimum_width = 50,
      render = "minimal",
      stages = "slide",
      top_down = true,
      timeout = 10000,
    })
  end,
}
