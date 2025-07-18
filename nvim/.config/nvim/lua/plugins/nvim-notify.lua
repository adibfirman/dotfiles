return {
  "rcarriga/nvim-notify",
  tag = "v3.15.0",
  config = function()
    vim.notify = require("notify").setup({
      timeout = 3000,
    })
  end,
}
