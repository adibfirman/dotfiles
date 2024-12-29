local telescope = require("telescope.builtin")

vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set("v", "<", "<gv")
vim.keymap.set("v", ">", ">gv")
vim.keymap.set("n", "<leader>ff", telescope.find_files, { desc = "Telescope find files" })
vim.keymap.set("n", "<leader>fg", telescope.live_grep, { desc = "Telescope live grep" })
vim.keymap.set("n", "<leader>fb", telescope.buffers, { desc = "Telescope buffers" })
vim.keymap.set("n", "<leader>gg", "<cmd>:lua Snacks.lazygit.open()<cr>", { desc = "Lazygit" })
vim.keymap.set("n", "<leader>l", "<cmd>Lazy<cr>", { desc = "Lazygit" })
vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle=true<cr>", { desc = "File Explorer" })

-- LSP
vim.keymap.set({ "n", "v" }, "<leader>ca", vim.lsp.buf.code_action, { desc = "Code Action" })
vim.keymap.set("n", "gd", vim.lsp.buf.definition, { desc = "Goto Definition" })
vim.keymap.set("n", "<leader>cl", "<cmd>LspInfo<cr>", { desc = "Lsp Info" })
vim.keymap.set("n", "gr", vim.lsp.buf.references, { desc = "References" })
-- vim.keymap.set('n', "gI", vim.lsp.buf.implementation, {desc = "Goto Implementation"} )
-- vim.keymap.set('n', "gy", vim.lsp.buf.type_definition, {desc = "Goto T[y]pe Definition"} )
-- vim.keymap.set('n', "gD", vim.lsp.buf.declaration, {desc = "Goto Declaration"} )
-- vim.keymap.set('n', "cf", vim.lsp.buf.format, {desc = "Format"} )
vim.keymap.set("n", "K", "<cmd>:lua vim.lsp.buf.hover() <cr>", { desc = "Hover" })
vim.keymap.set("n", "gK", "<cmd>:lua vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })
vim.keymap.set("i", "<c-k>", "<cmd> vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })
vim.keymap.set({ "n", "v" }, "<leader>cc", vim.lsp.codelens.run, { desc = "Run Codelens" })
vim.keymap.set("n", "<leader>cC", vim.lsp.codelens.refresh, { desc = "Refresh & Display Codelens" })
vim.keymap.set("n", "<leader>cr", vim.lsp.buf.rename, { desc = "Rename" })
-- vim.keymap.set('n', "<leader>cA", vim.lsp.action.source, {desc = "Source Action"} )

-- buffers
vim.keymap.set("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
vim.keymap.set("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
vim.keymap.set("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
vim.keymap.set("n", "<leader>bd", "<cmd>:lua Snacks.bufdelete() <cr>", { desc = "Delete Buffer" })
vim.keymap.set("n", "<leader>bo", "<cmd>:lua Snacks.bufdelete.other() <cr>", { desc = "Delete Other Buffers" })
vim.keymap.set("n", "<leader>bD", "<cmd>:bd<cr>", { desc = "Delete Buffer and Window" })

-- Clear search and stop snippet on escape
vim.keymap.set({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })
