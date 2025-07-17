return {
  "lukas-reineke/indent-blankline.nvim",
  main = "ibl",
  config = function()
    require("ibl").setup({
      indent = { char = "│" },
      whitespace = {
        remove_blankline_trail = false,
      },
      scope = { enabled = false },
    })
  end,
}
