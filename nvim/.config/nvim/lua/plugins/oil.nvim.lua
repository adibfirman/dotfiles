return {
  "stevearc/oil.nvim",
  version = "*",
  dependencies = { "nvim-tree/nvim-web-devicons" },
  config = function()
    require("oil").setup({
      columns = {
        "icon",
        "permissions",
        "size",
        "mtime",
      },
      view_options = {
        show_hidden = true,
        is_always_hidden = function(name, _)
          local folder_skip = { "dev-tools.locks", "dune.lock", "_build" }
          return vim.tbl_contains(folder_skip, name)
        end,
      },
      float = {
        max_width = 0.9,
        max_height = 0.7,
      },
      preview = {
        max_width = 0.5, -- or any ratio you like
        min_width = 40,
        border = "rounded",
      },
    })
  end,
}
