local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
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
      },
      tailwindcss = {
        root_dir = function(fname)
          local lsp_util = require("lspconfig.util")
          return lsp_util.root_pattern("tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs")(fname)
        end,
      },
      vtsls = {
        root_dir = get_root_dir,
      },
      tsserver = {
        root_dir = get_root_dir,
      },
    },
  },
}
