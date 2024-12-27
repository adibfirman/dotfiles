return {
  {
    'nvim-telescope/telescope.nvim',
    tag = '0.1.8',
    depedencies = {
      'nvim-lua/plenary.nvim',
    },
  },
  {
    "kdheepak/lazygit.nvim",
    lazy = true,
    cmd = {
      "LazyGit",
      "LazyGitConfig",
      "LazyGitCurrentFile",
      "LazyGitFilter",
      "LazyGitFilterCurrentFile",
    },
    dependencies = {
      "nvim-lua/plenary.nvim",
    },
  }
}
