return {
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
          local lsp_clients = vim.lsp.get_clients()
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
}
