return {
  "rcarriga/nvim-notify",
  version = "*",
  config = function()
    vim.notify = require("notify")
    require("notify").setup({
      timeout = 3000,
      top_down = true,
    })
  end,
}
