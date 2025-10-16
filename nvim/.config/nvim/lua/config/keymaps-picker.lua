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
    args = { "--no-ignore" },
    dirs = { vim.fn.getcwd() },
    regex = true,
  })
end, { desc = "Live Grep" })

vim.keymap.set("n", "<leader>ss", function()
  picker.lsp_symbols({
    layout = "vscode",
  })
end, { desc = "Find LSP Symbols" })

vim.keymap.set("n", "<leader>fb", function()
  picker.buffers({
    layout = "vscode",
  })
end, { desc = "Find buffers" })
