return {
  "stevearc/oil.nvim",
  dependencies = {
    "nvim-tree/nvim-web-devicons",
  },
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
    })

    _G.OilCopyFullPath = function()
      local oil = require("oil")
      local notify = require("snacks.notify")

      local entry = oil.get_cursor_entry()

      if entry and entry.name then
        local full_path = require("oil").get_current_dir() .. entry.name
        vim.fn.setreg("+", full_path)
        notify.info("Path Copied: " .. full_path)
      else
        notify.error("No valid file or path selected.")
      end
    end
  end,
}
