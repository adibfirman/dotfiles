return {
  {
    "sainnhe/edge",
    priority = 1000,
    config = function()
      vim.g.edge_enable_italic = true
      vim.cmd.colorscheme("edge")
    end,
  },
}
