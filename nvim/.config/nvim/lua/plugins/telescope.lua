return {
  "nvim-telescope/telescope.nvim",
  branch = "0.1.x",
  dependencies = {
    "nvim-lua/plenary.nvim",
    {
      "nvim-telescope/telescope-fzf-native.nvim",
      build = "make",
    },
    "nvim-telescope/telescope-smart-history.nvim",
    "kkharji/sqlite.lua",
  },
  config = function()
    local data = assert(vim.fn.stdpath("data")) --[[@as string]]

    require("telescope").setup({
      defaults = {
        file_ignore_patterns = { "dune.lock", ".git" },
        sorting_strategy = "ascending",
      },
      pickers = {
        live_grep = {
          additional_args = function()
            return { "--hidden" }
          end,
        },
      },
      extensions = {
        wrap_results = true,
        fzf = {},
        history = {
          path = vim.fs.joinpath(data, "telescope_history.sqlite3"),
          limit = 100,
        },
      },
    })

    pcall(require("telescope").load_extension, "fzf")
    pcall(require("telescope").load_extension, "smart_history")
  end,
}
