return {
  "nvim-neo-tree/neo-tree.nvim",
  branch = "v3.x",
  config = function()
    require("neo-tree").setup({
      window = {
        position = "left",
      },
      filesystem = {
        filtered_items = {
          visible = true,
          hide_dotfiles = true,
          hide_gitignored = true,
          hide_hidden = true,
        },
      },
      default_component_configs = {
        git_status = {
          symbols = {
            added = "",
            modified = "",
            deleted = "",
            renamed = "",
            untracked = "",
            ignored = "",
            unstaged = "",
            staged = "",
            conflict = "",
          },
        },
      },
    })
  end,
}
