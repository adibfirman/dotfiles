return {
  "williamboman/mason-lspconfig.nvim",
  lazy = false,
  dependencies = {
    "williamboman/mason.nvim",
  },
  config = function()
    require("mason-lspconfig").setup({
      automatic_installation = true,
    })
  end,
}
