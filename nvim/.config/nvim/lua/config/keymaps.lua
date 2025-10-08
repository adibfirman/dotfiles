vim.keymap.set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
vim.keymap.set("v", "<", "<gv", { desc = "Better indent to left" })
vim.keymap.set("v", ">", ">gv", { desc = "Better indent to right" })

-- notification stuff
vim.keymap.set("n", "<leader>nh", "<cmd>Notifications<cr>", { desc = "Show history of notification" })

-- Git stuff
-- vim.keymap.set("n", "<leader>gg", "<cmd>:lua Snacks.lazygit.open()<cr>", { desc = "Lazy Git" })
vim.keymap.set("n", "<leader>gg", function()
  local buf_path = vim.api.nvim_buf_get_name(0)
  if buf_path == "" then
    buf_path = vim.loop.cwd() -- fallback if buffer has no name
  end
  local dir = vim.fn.fnamemodify(buf_path, ":p:h")

  -- ask git for the root of this directory
  local git_root = vim.fn.systemlist("git -C " .. vim.fn.shellescape(dir) .. " rev-parse --show-toplevel")[1]

  -- fallback: if not a git repo, just use buffer dir to open it
  if git_root == nil or git_root == "" then
    git_root = dir
  end

  require("snacks").lazygit({ cwd = git_root })
end, { desc = "Lazygit (git root of buffer)" })

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

-- find and replace
vim.keymap.set("n", "<leader>sr", "<cmd>GrugFar<cr>", { desc = "Find and Replace" })

-- buffers
vim.keymap.set("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
vim.keymap.set("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
vim.keymap.set("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
vim.keymap.set("n", "<leader>bd", "<cmd>:lua Snacks.bufdelete() <cr>", { desc = "Delete Buffer" })
vim.keymap.set("n", "<leader>bo", "<cmd>:lua Snacks.bufdelete.other() <cr>", { desc = "Delete Other Buffers" })
vim.keymap.set("n", "<leader>z", "<cmd>:lua Snacks.zen.zen() <cr>", { desc = "Zen Mode / Focus Mode" })

-- Clear search and stop snippet on escape
vim.keymap.set({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  vim.cmd("delm!")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

require("config.keymaps-telescope")
require("config.keymaps-directory")
