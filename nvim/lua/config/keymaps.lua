local telescopebuiltin = require("telescope.builtin")
local fzf = require("fzf-lua")
local term_escape_timer = nil
local terminal_id = 2

vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set("v", "<", "<gv", { desc = "Better indent to left" })
vim.keymap.set("v", ">", ">gv", { desc = "Better indent to right" })

-- Terminal
vim.keymap.set("n", "<C-`>", "<cmd>:ToggleTerm<cr>", { desc = "Toggle terminal" })
vim.keymap.set("n", "<leader>tn", function()
  vim.cmd(terminal_id .. "ToggleTerm")
  terminal_id = terminal_id + 1
end, { desc = "Create a new terminal horizontally" })

vim.keymap.set("t", "<esc>", function()
  if term_escape_timer then
    vim.api.nvim_command("stopinsert")
    term_escape_timer = nil
  else
    term_escape_timer = vim.defer_fn(function()
      term_escape_timer = nil
    end, 300)
  end
end, { desc = "Go to normal mode in terminal", expr = true })

-- files/find
vim.keymap.set("n", "<leader>ff", telescopebuiltin.find_files, { desc = "Telescope find files" })
vim.keymap.set("n", "<leader>fg", telescopebuiltin.live_grep, { desc = "Telescope live grep" })
vim.keymap.set("n", "<leader>fb", telescopebuiltin.buffers, { desc = "Telescope buffers" })
vim.keymap.set("n", "<leader>gg", "<cmd>:lua Snacks.lazygit.open()<cr>", { desc = "Lazygit" })
vim.keymap.set("n", "<leader>e", "<cmd>Oil --float<cr>", { desc = "File Explorer" })
vim.keymap.set(
  "n",
  "<leader>cp",
  "<cmd>:lua OilCopyFullPath()<cr>",
  { desc = "Copy Current File Path with Oil", remap = true, silent = true }
)

-- search
vim.keymap.set("n", '<leader>s"', "<cmd>FzfLua registers<cr>", { desc = "Registers" })
vim.keymap.set("n", "<leader>sb", "<cmd>FzfLua grep_curbuf<cr>", { desc = "Buffer" })
vim.keymap.set("n", "<leader>sd", "<cmd>FzfLua diagnostics_document<cr>", { desc = "Document Diagnostics" })
vim.keymap.set(
  "n",
  "<leader>sg",
  "<cmd>:lua Snacks.dashboard.pick('live_grep', {root = false})<cr>",
  { desc = "Grep (Root Dir)" }
)
vim.keymap.set("n", "<leader>ss", function()
  fzf.lsp_document_symbols({ symbol_kind = { "Function", "Method" } })
end, { desc = "Goto Symbol" })

-- LSP
vim.keymap.set({ "n", "v" }, "<leader>ca", "<cmd>Lspsaga code_action<cr>", { desc = "Code Action" })
vim.keymap.set("n", "gd", "<cmd>Lspsaga goto_definition<cr>", { desc = "Goto Definition" })
vim.keymap.set("n", "gr", "<cmd>FzfLua lsp_references<cr>", { desc = "References" })
vim.keymap.set("n", "<leader>cf", vim.lsp.buf.format, { desc = "Format" })
vim.keymap.set("n", "<leader>cd", "<cmd>Lspsaga show_line_diagnostics<cr>", { desc = "Line Diagnostic" })
vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc<cr>", { desc = "Hover" })
vim.keymap.set("n", "<leader>cr", "<cmd>Lspsaga rename", { desc = "Rename" })
-- vim.keymap.set("n", "gI", "<cmd>FzfLua lsp_implementations<cr>", { desc = "Goto Implementation" })
-- vim.keymap.set("n", "gy", "<cmd>FzfLua lsp_typedefs<cr>", { desc = "Goto T[y]pe Definition" })
-- vim.keymap.set({ "n", "v" }, "<leader>cc", vim.lsp.codelens.run, { desc = "Run Codelens" })
-- vim.keymap.set("n", "gK", "<cmd>:lua vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })
-- vim.keymap.set("i", "<c-k>", "<cmd> vim.lsp.buf.signature_help() <cr>", { desc = "Signature Help" })

-- Windows stuff
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })
vim.keymap.set("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })
vim.keymap.set("n", "<leader>wm", "<cmd>WindowsMaximize<cr>", { desc = "Maximize Window", remap = true })

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
  vim.cmd("delm!")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })
