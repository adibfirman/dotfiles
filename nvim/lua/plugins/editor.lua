return {
  {
    "akinsho/toggleterm.nvim",
    version = "*",
    config = function()
      require("toggleterm").setup({
        size = 10,
        start_in_insert = true,
        insert_mappings = true,
        terminal_mappings = true,
      })
    end,
  },
  {
    "echasnovski/mini.hipatterns",
    version = "*",
    config = function()
      local hipatterns = require("mini.hipatterns")
      hipatterns.setup({
        highlighters = {
          fixme = { pattern = "%f[%w]()FIXME()%f[%W]", group = "MiniHipatternsFixme" },
          hack = { pattern = "%f[%w]()HACK()%f[%W]", group = "MiniHipatternsHack" },
          todo = { pattern = "%f[%w]()TODO()%f[%W]", group = "MiniHipatternsTodo" },
          note = { pattern = "%f[%w]()NOTE()%f[%W]", group = "MiniHipatternsNote" },
          hex_color = hipatterns.gen_highlighter.hex_color(),
        },
      })
    end,
  },
  {
    "echasnovski/mini.pairs",
    version = "*",
    config = function()
      require("mini.pairs").setup()
    end,
  },
  {
    "lewis6991/gitsigns.nvim",
    config = function()
      require("gitsigns").setup()
    end,
  },
  {
    "folke/snacks.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      lazygit = { enabled = true },
      scope = {},
      dim = {},
      indent = {},
      dashboard = {
        preset = {
          header = [[

 ▄▄▄      ▓█████▄  ██▓ ▄▄▄▄     █████▒██▓ ██▀███   ███▄ ▄███▓ ▄▄▄       ███▄    █      ▓█████▄ ▓█████ ██▒   █▓
▒████▄    ▒██▀ ██▌▓██▒▓█████▄ ▓██   ▒▓██▒▓██ ▒ ██▒▓██▒▀█▀ ██▒▒████▄     ██ ▀█   █      ▒██▀ ██▌▓█   ▀▓██░   █▒
▒██  ▀█▄  ░██   █▌▒██▒▒██▒ ▄██▒████ ░▒██▒▓██ ░▄█ ▒▓██    ▓██░▒██  ▀█▄  ▓██  ▀█ ██▒     ░██   █▌▒███   ▓██  █▒░
░██▄▄▄▄██ ░▓█▄   ▌░██░▒██░█▀  ░▓█▒  ░░██░▒██▀▀█▄  ▒██    ▒██ ░██▄▄▄▄██ ▓██▒  ▐▌██▒     ░▓█▄   ▌▒▓█  ▄  ▒██ █░░
 ▓█   ▓██▒░▒████▓ ░██░░▓█  ▀█▓░▒█░   ░██░░██▓ ▒██▒▒██▒   ░██▒ ▓█   ▓██▒▒██░   ▓██░ ██▓ ░▒████▓ ░▒████▒  ▒▀█░
 ▒▒   ▓▒█░ ▒▒▓  ▒ ░▓  ░▒▓███▀▒ ▒ ░   ░▓  ░ ▒▓ ░▒▓░░ ▒░   ░  ░ ▒▒   ▓▒█░░ ▒░   ▒ ▒  ▒▓▒  ▒▒▓  ▒ ░░ ▒░ ░  ░ ▐░
  ▒   ▒▒ ░ ░ ▒  ▒  ▒ ░▒░▒   ░  ░      ▒ ░  ░▒ ░ ▒░░  ░      ░  ▒   ▒▒ ░░ ░░   ░ ▒░ ░▒   ░ ▒  ▒  ░ ░  ░  ░ ░░
  ░   ▒    ░ ░  ░  ▒ ░ ░    ░  ░ ░    ▒ ░  ░░   ░ ░      ░     ░   ▒      ░   ░ ░  ░    ░ ░  ░    ░       ░░
      ░  ░   ░     ░   ░              ░     ░            ░         ░  ░         ░   ░     ░       ░  ░     ░
           ░                ░                                                       ░   ░                 ░
          ]],
        },
      },
    },
  },
  {
    "akinsho/bufferline.nvim",
    event = "VeryLazy",
    opts = {
      options = {
        close_command = function(n)
          ---@diagnostic disable-next-line: undefined-field
          Snacks.bufdelete(n)
        end,
        right_mouse_command = function(n)
          ---@diagnostic disable-next-line: undefined-field
          Snacks.bufdelete(n)
        end,
        diagnostics = "nvim_lsp",
        always_show_bufferline = false,
        offsets = {
          {
            filetype = "neo-tree",
            text = "Neo-tree",
            highlight = "Directory",
            text_align = "left",
          },
        },
      },
    },
    config = function(_, opts)
      require("bufferline").setup(opts)
      -- Fix bufferline when restoring a session
      vim.api.nvim_create_autocmd({ "BufAdd", "BufDelete" }, {
        callback = function()
          vim.schedule(function()
            pcall(nvim_bufferline)
          end)
        end,
      })
    end,
  },
  {
    "nvim-telescope/telescope-fzf-native.nvim",
    build = "cmake -S. -Bbuild -DCMAKE_BUILD_TYPE=Release && cmake --build build --config Release",
  },
  {
    "nvim-telescope/telescope.nvim",
    tag = "0.1.8",
    depedencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
    },
    config = function()
      require("telescope").setup({
        defaults = {
          sorting_strategy = "ascending",
          layout_config = { prompt_position = "top" },
        },
        pickers = {
          functions = {
            theme = "dropdown",
            previewer = false,
          },
        },
        extensions = {
          fzf = {
            fuzzy = true,
            override_generic_sorter = true,
            override_file_sorter = true,
          },
        },
      })

      require("telescope").load_extension("fzf")
    end,
  },
  {
    "ibhagwan/fzf-lua",
    cmd = "FzfLua",
    depedencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
    },
    config = function(_, opts)
      if opts[1] == "default-title" then
        local function fix(t)
          t.prompt = t.prompt ~= nil and " " or nil
          for _, v in pairs(t) do
            if type(v) == "table" then
              fix(v)
            end
          end
          return t
        end
        opts = vim.tbl_deep_extend("force", fix(require("fzf-lua.profiles.default-title")), opts)
        opts[1] = nil
      end
      require("fzf-lua").setup(opts)
    end,
  },
  {
    "stevearc/dressing.nvim",
    opts = {},
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
        theme = "auto",
        component_separators = "",
        section_separators = { right = "", left = "" },
        globalstatus = true,
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
    "stevearc/oil.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim",
      "nvim-tree/nvim-web-devicons",
    },
    config = function()
      -- helper function to parse output
      local function parse_output(proc)
        local result = proc:wait()
        local ret = {}
        if result.code == 0 then
          for line in vim.gsplit(result.stdout, "\n", { plain = true, trimempty = true }) do
            -- Remove trailing slash
            line = line:gsub("/$", "")
            ret[line] = true
          end
        end
        return ret
      end

      -- build git status cache
      local function new_git_status()
        return setmetatable({}, {
          __index = function(self, key)
            local ignore_proc = vim.system(
              { "git", "ls-files", "--ignored", "--exclude-standard", "--others", "--directory" },
              {
                cwd = key,
                text = true,
              }
            )
            local tracked_proc = vim.system({ "git", "ls-tree", "HEAD", "--name-only" }, {
              cwd = key,
              text = true,
            })
            local ret = {
              ignored = parse_output(ignore_proc),
              tracked = parse_output(tracked_proc),
            }

            rawset(self, key, ret)
            return ret
          end,
        })
      end
      local git_status = new_git_status()

      -- Clear git status cache on refresh
      local refresh = require("oil.actions").refresh
      local orig_refresh = refresh.callback
      refresh.callback = function(...)
        git_status = new_git_status()
        orig_refresh(...)
      end

      require("oil").setup({
        columns = {
          "icon",
          "size",
          "mtime",
        },
        view_options = {
          show_hidden = true,
          -- is_hidden_file = function(name, bufnr)
          --   local dir = require("oil").get_current_dir(bufnr)
          --   local is_dotfile = vim.startswith(name, ".") and name ~= ".."
          --   -- if no local directory (e.g. for ssh connections), just hide dotfiles
          --   if not dir then
          --     return is_dotfile
          --   end
          --   -- dotfiles are considered hidden unless tracked
          --   if is_dotfile then
          --     return not git_status[dir].tracked[name]
          --   else
          --     -- Check if file is gitignored
          --     return git_status[dir].ignored[name]
          --   end
          -- end,
        },
      })
    end,
  },
}
