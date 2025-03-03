return {
  {
    "MagicDuck/grug-far.nvim",
    config = function()
      require("grug-far").setup()
    end,
  },
  {
    "echasnovski/mini.ai",
    version = "*",
    config = function()
      require("mini.ai").setup()
    end,
  },
  {
    "echasnovski/mini.surround",
    version = "*",
    config = function()
      require("mini.surround").setup()
    end,
  },
  {
    "Bekaboo/dropbar.nvim",
    lazy = false,
    priority = 999,
    config = function()
      require("dropbar").setup({
        sources = {
          lsp = {
            max_depth = 1,
          },
        },
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
    "echasnovski/mini.diff",
    version = "*",
    config = function()
      require("mini.diff").setup()
    end,
  },
  {
    "folke/snacks.nvim",
    lazy = false,
    priority = 1000,
    opts = {
      lazygit = { enabled = true },
      scope = {},
      indent = {},
      zoom = {},
      dashboard = {
        width = 72,
        sections = {
          {
            section = "terminal",
            align = "center",
            cmd = "curl -s 'https://wttr.in/Jakarta?0'",
            height = 8,
            width = 72,
            padding = 1,
          },
          {
            align = "center",
            padding = 1,
            text = {
              { "  Update ", hl = "Label" },
              { "  Sessions ", hl = "@property" },
              { "  Last Session ", hl = "Number" },
              { "  Files ", hl = "DiagnosticInfo" },
              { "  Recent ", hl = "@string" },
            },
          },
          { section = "startup", padding = 1 },
          { icon = "󰏓 ", title = "Projects", section = "projects", indent = 2, padding = 1 },
          { icon = " ", title = "Recent Files", section = "recent_files", indent = 2, padding = 1 },
          { text = "", action = ":Lazy update", key = "u" },
          { text = "", action = ":PersistenceLoadSession", key = "s" },
          { text = "", action = ":PersistenceLoadLast", key = "l" },
        },
      },
    },
  },
  {
    "ibhagwan/fzf-lua",
    cmd = "FzfLua",
    dependencies = {
      "nvim-tree/nvim-web-devicons",
    },
    opts = {
      files = {
        cwd_prompt = false,
      },
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
      require("oil").setup({
        columns = {
          "icon",
          "size",
          "mtime",
        },
        view_options = {
          show_hidden = true,
        },
      })

      _G.OilCopyFullPath = function()
        local oil = require("oil")
        local entry = oil.get_cursor_entry()
        if entry and entry.name then
          local full_path = require("oil").get_current_dir() .. entry.name
          vim.fn.setreg("+", full_path)
          print("Copied: " .. full_path)
        else
          print("No valid file or path selected.")
        end
      end
    end,
  },
}
