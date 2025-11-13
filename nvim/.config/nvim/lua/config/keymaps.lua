local set = vim.keymap.set

set("n", "<leader>qq", "<cmd>qa<cr>", { desc = "Quit All" })
set("v", "<", "<gv", { desc = "Better indent to left" })
set("v", ">", ">gv", { desc = "Better indent to right" })

-- notification stuff
set("n", "<leader>nh", "<cmd>Notifications<cr>", { desc = "Show history of notification" })

-- show which-key helpers
set("n", "<leader>?", function()
  require("which-key").show({ global = false })
end, { desc = "Buffer Local Keymaps (which-key)" })

-- Git stuff
set("n", "<leader>gg", function()
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

set("n", "<leader>gb", function()
  require("snacks").git.blame_line()
end, { desc = "Git Blame Line" })

-- LSP
set({ "n", "v" }, "<leader>ca", "<cmd>Lspsaga code_action<cr>", { desc = "Code Action" })
set("n", "gd", "<cmd>Lspsaga goto_definition<cr>", { desc = "Goto Definition" })
set("n", "<leader>pd", "<cmd>Lspsaga peek_definition<cr>", { desc = "Sneak-peek of type definition" })
set("n", "gr", "<cmd>Lspsaga finder<cr>", { desc = "Show References by search in directory" })
set("n", "<leader>cf", vim.lsp.buf.format, { desc = "Format" })
set("n", "<leader>sd", "<cmd>Lspsaga show_buf_diagnostics<cr>", { desc = "Show the diagnostic over buffer" })
set("n", "<leader>cd", "<cmd>Lspsaga show_line_diagnostics<cr>", { desc = "Line Diagnostic" })
set("n", "K", "<cmd>Lspsaga hover_doc<cr>", { desc = "Hover" })
set("n", "<leader>cr", "<cmd>Lspsaga rename<cr>", { desc = "Rename" })
set("n", "]d", function()
  require("lspsaga.diagnostic"):goto_next()
end, { desc = "Jump to the next diagnostic" })
set("n", "[d", function()
  require("lspsaga.diagnostic"):goto_prev()
end, { desc = "Jump to the prev diagnostic" })

-- Windows stuff
set("n", "<C-h>", "<C-w>h", { desc = "Go to Left Window", remap = true })
set("n", "<C-j>", "<C-w>j", { desc = "Go to Lower Window", remap = true })
set("n", "<C-k>", "<C-w>k", { desc = "Go to Upper Window", remap = true })
set("n", "<C-l>", "<C-w>l", { desc = "Go to Right Window", remap = true })
set("n", "<leader>wo", "<C-w>o", { desc = "Delete others split window", remap = true, silent = true })
set("n", "<leader>wd", "<C-W>c", { desc = "Delete Window", remap = true })
-- set("n", "<leader>wm", "<cmd>FocusMaximise<cr>", { desc = "Maximize window for focus", remap = true })

-- find and replace
set("n", "<leader>fr", "<cmd>GrugFar<cr>", { desc = "Find and Replace" })

-- buffers
set("n", "<S-h>", "<cmd>bprevious<cr>", { desc = "Prev Buffer" })
set("n", "<S-l>", "<cmd>bnext<cr>", { desc = "Next Buffer" })
set("n", "<leader>bb", "<cmd>e #<cr>", { desc = "Switch to Other Buffer" })
set("n", "<leader>bd", "<cmd>:lua Snacks.bufdelete() <cr>", { desc = "Delete Buffer" })
set("n", "<leader>bo", "<cmd>:lua Snacks.bufdelete.other() <cr>", { desc = "Delete Other Buffers" })
set("n", "<leader>z", "<cmd>:lua Snacks.zen.zen() <cr>", { desc = "Zen Mode / Focus Mode" })
set("n", "<leader>bD", ":bd<CR>", { desc = "Delete buffer and close window" })

-- Clear search and stop snippet on escape
set({ "i", "n", "s" }, "<esc>", function()
  vim.cmd("noh")
  vim.cmd("delm!")
  return "<esc>"
end, { expr = true, desc = "Escape and Clear hlsearch" })

-- setup multi cursor
set({ "n", "x" }, "<c-d>", function()
  require("multicursor-nvim").matchAddCursor(1)
end, { desc = "Multiple cursor in the same word selected go down" })
set({ "n", "x" }, "<c>D", function()
  require("multicursor-nvim").matchSkipCursor(1)
end, { desc = "Multiple cursor in the same word selected go up" })

-- auto write log
set({ "n", "v" }, "<leader>l", function()
  require("chainsaw").variableLog()
end, { desc = "insert log under the cursor" })

set({ "n", "v" }, "<leader>lc", function()
  require("chainsaw").removeLogs()
end, { desc = "Clear all logs marked" })

require("config.keymaps-directory")
require("config.keymaps-picker")
