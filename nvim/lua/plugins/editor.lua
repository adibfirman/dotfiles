return {
  {
    'nvim-telescope/telescope.nvim',
    tag = '0.1.8',
    depedencies = {
      'nvim-lua/plenary.nvim',
      "nvim-tree/nvim-web-devicons",
    },
  },
  {
    'stevearc/dressing.nvim',
    opts = {},
  },
  {
    "folke/snacks.nvim",
    opts = {
      lazygit = { enabled = true },
    }
  },
  {
    "nvim-lualine/lualine.nvim",
    event = "VeryLazy",
    dependencies = {
      "linrongbin16/lsp-progress.nvim",
      config = function()
        require("lsp-progress").setup({
          client_format = function(client_name, spinner, series_messages)
            if #series_messages == 0 then
              return nil
            end
            return {
              name = client_name,
              body = spinner .. " " .. table.concat(series_messages, ", "),
            }
          end,
          format = function(client_messages)
            --- @param name string
            --- @param msg string?
            --- @return string
            local function stringify(name, msg)
              return msg and string.format("%s %s", name, msg) or name
            end

            local sign = "" -- nf-fa-gear \uf013
            local lsp_clients = vim.lsp.get_active_clients()
            local messages_map = {}
            for _, climsg in ipairs(client_messages) do
              messages_map[climsg.name] = climsg.body
            end

            if #lsp_clients > 0 then
              table.sort(lsp_clients, function(a, b)
                return a.name < b.name
              end)
              local builder = {}
              for _, cli in ipairs(lsp_clients) do
                if type(cli) == "table" and type(cli.name) == "string" and string.len(cli.name) > 0 then
                  if messages_map[cli.name] then
                    table.insert(builder, stringify(cli.name, messages_map[cli.name]))
                  else
                    table.insert(builder, stringify(cli.name))
                  end
                end
              end
              if #builder > 0 then
                return sign .. " " .. table.concat(builder, ", ")
              end
            end
            return ""
          end,
        })
      end,
    },
    opts = {
      options = {
        theme = "edge",
        component_separators = "",
        section_separators = { right = "", left = "" },
      },
      -- ----- reference position ------
      -- +-------------------------------------------------+
      -- | A | B | C                             X | Y | Z |
      -- +-------------------------------------------------+
      sections = {
        lualine_a = {
          {
            "mode",
            separator = { right = "" },
            padding = { left = 1 },
            fmt = function(res)
              return res:sub(1, 1)
            end,
          },
        },
        lualine_b = { "branch" },
        lualine_c = {
          "diff",
          "diagnostic",
        },
        lualine_x = {
          {
            function()
              return require("lsp-progress").progress()
            end,
            separator = { left = "" },
            color = { bg = "#414550" },
          },
        },
        lualine_y = { "filetype", "progress" },
        lualine_z = {
          { "location", padding = { right = 1 } },
        },
      },
      tabline = {},
      winbar = {},
      extensions = {},
    },
  },
  {
    "nvim-neo-tree/neo-tree.nvim",
    branch = "v3.x",
    lazy = false,
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
      "MunifTanjim/nui.nvim",
    },
    opts = {
      sources = { "filesystem", "buffers", "git_status", "document_symbols" },
      open_files_do_not_replace_types = { "terminal", "Trouble", "trouble", "qf", "Outline" },
      filesystem = {
        bind_to_cwd = false,
        follow_current_file = { enabled = true },
        use_libuv_file_watcher = true,
        filtered_items = {
          visible = true,
          hide_dotfiles = true,
          hide_gitignored = true,
          hide_hidden = true,
        },
      },
      window = {
        mappings = {
          ["<space>"] = "none",
          ["Y"] = {
            function(state)
              local node = state.tree:get_node()
              local path = node:get_id()
              vim.fn.setreg("+", path, "c")
            end,
            desc = "Copy Path to Clipboard",
          },
          ["O"] = {
            function(state)
              require("lazy.util").open(state.tree:get_node().path, { system = true })
            end,
            desc = "Open with System Application",
          },
        },
      },
      default_component_configs = {
        indent = {
          with_expanders = true, -- if nil and file nesting is enabled, will enable expanders
          expander_collapsed = "",
          expander_expanded = "",
          expander_highlight = "NeoTreeExpander",
        },
        git_status = {
          symbols = {
            added = "",
            modified = "",
            deleted = "",
            renamed = "",
            untracked = "",
            ignored = "",
            unstaged = "",
            staged = "",
            conflict = "",
          },
        },
      },
    },
    config = function(_, opts)
      local function on_move(data)
        LazyVim.lsp.on_rename(data.source, data.destination)
      end

      local events = require("neo-tree.events")
      opts.event_handlers = opts.event_handlers or {}
      vim.list_extend(opts.event_handlers, {
        { event = events.FILE_MOVED, handler = on_move },
        { event = events.FILE_RENAMED, handler = on_move },
        {
          event = events.FILE_OPEN_REQUESTED,
          handler = function()
            require("neo-tree.command").execute({ action = "close" })
          end,
        },
      })
      require("neo-tree").setup(opts)
      vim.api.nvim_create_autocmd("TermClose", {
        pattern = "*lazygit",
        callback = function()
          if package.loaded["neo-tree.sources.git_status"] then
            require("neo-tree.sources.git_status").refresh()
          end
        end,
      })
    end,
  }
}
