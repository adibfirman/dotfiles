local telescope = require('telescope.builtin')

vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set('n', '<leader>ff', telescope.find_files, { desc = 'Telescope find files' })
vim.keymap.set('n', '<leader>fg', telescope.live_grep, { desc = 'Telescope live grep' })
vim.keymap.set('n', '<leader>fb', telescope.buffers, { desc = 'Telescope buffers' })
vim.keymap.set("n", "<leader>gg", function() Snacks.lazygit.open() end, { desc = "Lazygit" })
vim.keymap.set("n", "<leader>l", "<cmd>Lazy<cr>", { desc = "Lazygit" })
vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle=true<cr>", { desc = "File Explorer" })

-- Clear search and stop snippet on escape
vim.keymap.set({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

