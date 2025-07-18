vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set("v", "<", "<gv", { desc = "Better indent to left" })
vim.keymap.set("v", ">", ">gv", { desc = "Better indent to right" })

-- notification stuff
vim.keymap.set("n", "<leader>nh", "<cmd>Notifications<cr>", { desc = "Show history of notification" })

-- Git stuff
vim.keymap.set("n", "<leader>gg", "<cmd>LazyGit<cr>", { desc = "Lazy Git" })

-- open directory
vim.keymap.set("n", "<leader>e", "<cmd>Oil --float<cr>", { desc = "File Explorer" })

-- copy path when the during the oil is active
vim.keymap.set("n", "<leader>cp", "<cmd>:lua OilCopyFullPath()<cr>", { desc = "Copy Current File Path with Oil", remap = true, silent = true }) -- this function is implemented under the plugins config, check plugins/oil

-- LSP
vim.keymap.set({ "n", "v" }, "<leader>ca", "<cmd>Lspsaga code_action<cr>", { desc = "Code Action" })
vim.keymap.set("n", "gd", "<cmd>Lspsaga goto_definition<cr>", { desc = "Goto Definition" })
vim.keymap.set("n", "<leader>pd", "<cmd>Lspsaga peek_definition<cr>", { desc = "Sneak-peek of type definition" })
vim.keymap.set("n", "gr", "<cmd>Lspsaga finder<cr>", { desc = "Show References by search in directory" })
vim.keymap.set("n", "<leader>cf", vim.lsp.buf.format, { desc = "Format" })
vim.keymap.set("n", "<leader>sd", "<cmd>Lspsaga show_buf_diagnostics<cr>", { desc = "Show the diagnostic over buffer" })
vim.keymap.set("n", "<leader>cd", "<cmd>Lspsaga show_line_diagnostics<cr>", { desc = "Line Diagnostic" })
vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc<cr>", { desc = "Hover" })
vim.keymap.set("n", "<leader>cr", "<cmd>Lspsaga rename<cr>", { desc = "Rename" })
vim.keymap.set("n", "]d", "<cmd>:lua require('lspsaga.diagnostic'):goto_next()<cr>", { desc = "Jump to the next diagnostic" })
vim.keymap.set("n", "[d", "<cmd>:lua require('lspsaga.diagnostic'):goto_prev()<cr>", { desc = "Jump to the next diagnostic" })

-- Windows stuff
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })
vim.keymap.set("n", "<leader>wo", "<C-w>o", { desc = "Delete others split window", remap = true, silent = true })
vim.keymap.set("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })
vim.keymap.set("n", "<leader>wm", "<cmd>FocusMaximise<cr>", { desc = "Maximize window for focus", remap = true })

-- buffers
vim.keymap.set("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
vim.keymap.set("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
vim.keymap.set("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
vim.keymap.set("n", "<leader>bd", "<cmd>bd<cr>", { desc = "Delete Current Buffer" })
vim.keymap.set("n", "<leader>bo", "<cmd>:lua Snacks.bufdelete.other() <cr>", { desc = "Delete Other Buffers" })
vim.keymap.set("n", "<leader>bD", "<cmd>:bd<cr>", { desc = "Delete Buffer and Window" })

-- Clear search and stop snippet on escape
vim.keymap.set({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  vim.cmd("delm!")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

require("config.keymaps-telescope")
