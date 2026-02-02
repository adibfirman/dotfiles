local picker = require("snacks.picker")

vim.keymap.set("n", "<leader>ff", function()
  picker.files({
    finder = "files",
    format = "file",
    show_empty = true,
    supports_live = true,
    hidden = true,
  })
end, { desc = "Find Files" })

vim.keymap.set("n", "<leader>sg", function()
  picker.grep({
    hidden = true,
    supports_live = false,
    dirs = { vim.fn.getcwd() },
    regex = false,
  })
end, { desc = "Live Grep" })

vim.keymap.set("n", "<leader>ss", function()
  picker.lsp_symbols({
    layout = "vertical",
    filter = { default = true },
  })
end, { desc = "Find LSP Symbols" })

vim.keymap.set("n", "<leader>fb", function()
  picker.buffers({
    on_show = function()
      vim.cmd.stopinsert()
    end,
    finder = "buffers",
    format = "buffer",
    hidden = false,
    unloaded = true,
    current = true,
    sort_lastused = true,
    win = {
      input = {
        keys = {
          ["d"] = "bufdelete",
        },
      },
      list = { keys = { ["d"] = "bufdelete" } },
    },
    layout = "vscode",
  })
end, { desc = "Find buffers" })
