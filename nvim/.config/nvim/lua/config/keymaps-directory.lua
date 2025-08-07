-- Inside your Neovim config
local oil_quit_timer = nil
local oil_quit_pending = false

local function confirm_quit_oil()
  if oil_quit_pending then
    -- Second press: quit
    vim.cmd("close") -- or `:q`
    oil_quit_pending = false
    if oil_quit_timer then
      oil_quit_timer:stop()
      oil_quit_timer:close()
      oil_quit_timer = nil
    end
  else
    -- First press: set pending and show message
    oil_quit_pending = true
    vim.notify("Press 'q' again to quit Oil", vim.log.levels.INFO)

    -- Reset after 1.5 seconds
    oil_quit_timer = vim.loop.new_timer()
    oil_quit_timer:start(1500, 0, function()
      oil_quit_pending = false
      oil_quit_timer:stop()
      oil_quit_timer:close()
      oil_quit_timer = nil
    end)
  end
end

local copy_full_path = function()
  local oil = require("oil")
  local entry = oil.get_cursor_entry()

  if entry and entry.name then
    local full_path = require("oil").get_current_dir() .. entry.name
    vim.fn.setreg("+", full_path)
    vim.notify("Path Copied: " .. full_path)
  else
    vim.notify("No valid file or path selected.")
  end
end

local function open_dir_in_file_manager()
  local oil = require("oil")
  local path = oil.get_current_dir()

  local open_cmd
  if vim.fn.has("mac") == 1 then
    open_cmd = { "open", path }
  elseif vim.fn.has("unix") == 1 then
    open_cmd = { "xdg-open", path }
  elseif vim.fn.has("win32") == 1 then
    open_cmd = { "explorer", path }
  else
    vim.notify("Unsupported OS for opening file explorer", vim.log.levels.ERROR)
    return
  end

  vim.fn.jobstart(open_cmd, { detach = true })
end

-- open directory
vim.keymap.set("n", "<leader>e", "<cmd>Oil --float<cr>", { desc = "File Explorer" })

-- copy current path
vim.api.nvim_create_autocmd("FileType", {
  pattern = "oil",
  callback = function()
    vim.keymap.set("n", "<leader>cp", copy_full_path, {
      buffer = true,
      desc = "Copy Current File Path",
    })
  end,
})

-- open file explorer
vim.api.nvim_create_autocmd("FileType", {
  pattern = "oil",
  callback = function()
    vim.keymap.set("n", "<leader>ge", open_dir_in_file_manager, {
      buffer = true,
      desc = "Open current dir in system file manager",
    })
  end,
})

-- Apply only to Oil buffers
vim.api.nvim_create_autocmd("FileType", {
  pattern = "oil",
  callback = function()
    vim.keymap.set("n", "q", confirm_quit_oil, {
      buffer = true,
      desc = "Double-q to quit Oil",
    })
  end,
})
