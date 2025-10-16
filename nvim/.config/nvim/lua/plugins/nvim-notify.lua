return {
  "rcarriga/nvim-notify",
  version = "*",
  enabled = false,
  config = function()
    require("notify").setup({
      timeout = 3000,
      render = "wrapped-compact",
    })
    vim.notify = require("notify")
  end,
}
