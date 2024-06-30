local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

require("lazyvim.util").lsp.on_attach(function(client)
  local active_clients = vim.lsp.get_clients()
  if client.name == "vtsls" then
    for _, client_ in pairs(active_clients) do
      -- stop tsserver if vtsls is already active
      if client_.name == "tsserver" then
        client_.stop()
      end
    end
  end
end)

return {
  "neovim/nvim-lspconfig",
  dependencies = {
    "williamboman/mason.nvim",
    "williamboman/mason-lspconfig.nvim",
  },
  opts = {
    inlay_hints = { enabled = false },
    servers = {
      eslint = {
        root_dir = get_root_dir,
        format = true,
        quiet = false,
        settings = {
          useFlatConfig = true,
          experimental = {
            useFlatConfig = nil,
          },
        },
      },
      tailwindcss = {
        root_dir = function(fname)
          local lsp_util = require("lspconfig.util")
          return lsp_util.root_pattern("tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs")(fname)
        end,
      },
      tsserver = {
        root_dir = get_root_dir,
      },
      vtsls = {
        root_dir = get_root_dir,
      },
    },
    setup = {
      eslint = function()
        require("lazyvim.util").lsp.on_attach(function(client)
          if client.name == "eslint" then
            client.server_capabilities.documentFormattingProvider = true
          elseif client.name == "tsserver" or client.name == "vtsls" then
            client.server_capabilities.documentFormattingProvider = false
          end
        end)
      end,
      -- vtsls = function()
      --   require("lazyvim.util").lsp.on_attach(function(client)
      --     if client.name == "tsserver" then
      --       client.stop(true)
      --     end
      --   end)
      -- end,
    },
  },
}
