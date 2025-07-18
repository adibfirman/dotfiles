local builtin = require("telescope.builtin")

vim.keymap.set("n", "<leader>ff", function()
  builtin.find_files({ hidden = true })
end, { desc = "Telescope find files" })

vim.keymap.set("n", "<leader>sg", function()
  builtin.live_grep({ hidden = true })
end, { desc = "Grep (Root Dir)" })

vim.keymap.set("n", "<leader>sb", function()
  builtin.current_buffer_fuzzy_find({
    previewer = false,
  })
end, { desc = "Search in the current buffer" })

vim.keymap.set("n", "<leader>ss", builtin.lsp_document_symbols, { desc = "Goto Symbol" })
vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "Telescope buffers" })
