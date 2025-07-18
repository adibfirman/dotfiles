return {
  "lewis6991/gitsigns.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
  },
  config = function()
    require("gitsigns").setup({
      current_line_blame = true,
      current_line_blame_formatter = "     <author>, <author_time:%R> - <summary>",
    })
  end,
}
