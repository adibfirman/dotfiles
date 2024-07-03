local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

local function get_node_version()
  local handle = io.popen("node -v")
  local version = handle:read("*a")
  handle:close()
  return version
end

local function is_node_version_greater_than_16()
  local version = get_node_version()
  local major_version = tonumber(version:match("v(%d+)"))

  if major_version > 16 then
    return true
  else
    return false
  end
end

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
      tsserver = function()
        require("lazyvim.util").lsp.on_attach(function(client)
          if client.name == "tsserver" then
            if is_node_version_greater_than_16() then
              client.stop(true)
            end
          end
        end)
      end,
    },
  },
}
