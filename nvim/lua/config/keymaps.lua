local telescope = require("telescope.builtin")
local fzf = require("fzf-lua")

vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set("n", "<leader>q", "<cmd>q<cr>", { desc = "Quit One" })
vim.keymap.set("v", "<", "<gv")
vim.keymap.set("v", ">", ">gv")

-- files/find
vim.keymap.set("n", "<leader>ff", telescope.find_files, { desc = "Telescope find files" })
vim.keymap.set("n", "<leader>fg", telescope.live_grep, { desc = "Telescope live grep" })
vim.keymap.set("n", "<leader>fb", telescope.buffers, { desc = "Telescope buffers" })
vim.keymap.set("n", "<leader>gg", "<cmd>:lua Snacks.lazygit.open()<cr>", { desc = "Lazygit" })
-- vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle=true<cr>", { desc = "File Explorer" })
vim.keymap.set("n", "<leader>e", "<CMD>Oil --float<CR>", { desc = "File Explorer" })

-- search
vim.keymap.set("n", '<leader>s"', "<cmd>FzfLua registers<cr>", { desc = "Registers" })
vim.keymap.set("n", "<leader>sb", "<cmd>FzfLua grep_curbuf<cr>", { desc = "Buffer" })
vim.keymap.set("n", "<leader>sd", "<cmd>FzfLua diagnostics_document<cr>", { desc = "Document Diagnostics" })
-- vim.keymap.set("n", "<leader>sg", function()
--   fzf.grep({
--     cwd = vim.fn.systemlist("git rev-parse --show-toplevel")[1] or vim.loop.cwd(),
--     symbol_kind = { "Function", "Method" }
--   })
-- end, { desc = "Grep (Root Dir)" })

-- vim.keymap.set("n", "<leader>sG", function()
--   fzf.grep({
--     cwd = vim.fn.getcwd(),
--     symbol_kind = { "Function", "Method" }
--   })
-- end, { desc = "Grep (cwd)" })

vim.keymap.set("n", "<leader>ss", function()
  fzf.lsp_document_symbols({ symbol_kind = { "Function", "Method" } })
end, { desc = "Goto Symbol" })

-- LSP
vim.keymap.set({ "n", "v" }, "<leader>ca", vim.lsp.buf.code_action, { desc = "Code Action" })
vim.keymap.set("n", "gd", vim.lsp.buf.definition, { desc = "Goto Definition" })
vim.keymap.set("n", "<leader>cl", "<cmd>LspInfo<cr>", { desc = "Lsp Info" })
vim.keymap.set("n", "gr", vim.lsp.buf.references, { desc = "References" })
vim.keymap.set("n", "gI", vim.lsp.buf.implementation, { desc = "Goto Implementation" })
vim.keymap.set("n", "gy", vim.lsp.buf.type_definition, { desc = "Goto T[y]pe Definition" })
vim.keymap.set("n", "gD", vim.lsp.buf.declaration, { desc = "Goto Declaration" })
vim.keymap.set("n", "cf", vim.lsp.buf.format, { desc = "Format" })
vim.keymap.set("n", "K", "<cmd>:lua vim.lsp.buf.hover() <cr>", { desc = "Hover" })
vim.keymap.set("n", "gK", "<cmd>:lua vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })
vim.keymap.set("i", "<c-k>", "<cmd> vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })
vim.keymap.set({ "n", "v" }, "<leader>cc", vim.lsp.codelens.run, { desc = "Run Codelens" })
vim.keymap.set("n", "<leader>cC", vim.lsp.codelens.refresh, { desc = "Refresh & Display Codelens" })
vim.keymap.set("n", "<leader>cr", vim.lsp.buf.rename, { desc = "Rename" })

-- Windows stuff
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })
vim.keymap.set("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })

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
