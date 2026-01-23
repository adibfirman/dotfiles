return {
  "nvim-tree/nvim-tree.lua",
  version = "*",
  lazy = false,
  dependencies = { "nvim-tree/nvim-web-devicons" },
  keys = {
    { "<leader>e", "<cmd>NvimTreeToggle<CR>", desc = "File Explorer" },
  },
  config = function()
    -- Disable netrw
    vim.g.loaded_netrw = 1
    vim.g.loaded_netrwPlugin = 1

    local function on_attach(bufnr)
      local api = require("nvim-tree.api")

      -- Default mappings
      api.config.mappings.default_on_attach(bufnr)

      local function opts(desc)
        return { desc = "nvim-tree: " .. desc, buffer = bufnr, noremap = true, silent = true, nowait = true }
      end

      -- Copy relative path
      vim.keymap.set("n", "<leader>cp", function()
        local node = api.tree.get_node_under_cursor()
        local relative = vim.fn.fnamemodify(node.absolute_path, ":.")
        vim.fn.setreg("+", relative)
        vim.notify("Path copied: " .. relative)
      end, opts("Copy Relative Path"))

      -- Open in Finder/File Manager
      vim.keymap.set("n", "<leader>o", function()
        local node = api.tree.get_node_under_cursor()
        local path = node.type == "directory" and node.absolute_path or vim.fn.fnamemodify(node.absolute_path, ":h")
        if vim.fn.has("mac") == 1 then
          vim.fn.jobstart({ "open", path }, { detach = true })
        elseif vim.fn.has("unix") == 1 then
          vim.fn.jobstart({ "xdg-open", path }, { detach = true })
        elseif vim.fn.has("win32") == 1 then
          vim.fn.jobstart({ "explorer", path }, { detach = true })
        end
      end, opts("Open in File Manager"))
    end

    require("nvim-tree").setup({
      on_attach = on_attach,
      view = {
        side = "right",
        width = 60,
        signcolumn = "no", -- Remove sign column for compact layout
      },
      git = {
        enable = true,
        ignore = false,
      },
      filters = {
        dotfiles = false, -- Show hidden files
        custom = { ".DS_Store", ".git" },
      },
      renderer = {
        highlight_git = true, -- Keep filename colors based on git status
        icons = {
          git_placement = "after", -- Move git icons after filename
          show = {
            file = true,
            folder = true,
            folder_arrow = true,
            git = false, -- Hide git status icons (✗, ★, etc.)
          },
        },
      },
    })
  end,
}
