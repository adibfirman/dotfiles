return {
  {
    'nvim-telescope/telescope.nvim',
    tag = '0.1.8',
    depedencies = {
      'nvim-lua/plenary.nvim',
    },
  },
  {
    "folke/snacks.nvim",
    opts = {
      lazygit = { enabled = true }
    }
  }
}
