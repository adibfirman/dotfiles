return {
  'nvim-treesitter/nvim-treesitter',
  build = ':TSUpdate',
  setup = function()
    require('nvim-treesitter.config').setup({
      ensure_installed = {"lua", "vue", "javascript", "typescript", "go"},
      highlight = {enable = true},
      indent = {enable = true}
    })
  end
}
