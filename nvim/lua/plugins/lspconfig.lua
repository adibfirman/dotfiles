local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

return {
  -- "williamboman/mason.nvim",
  -- "williamboman/mason-lspconfig.nvim",
  "neovim/nvim-lspconfig",
  opts = {
    servers = {
      eslint = {
        root_dir = get_root_dir,
        format = true,
        quiet = false,
      },
      tsserver = {
        root_dir = get_root_dir,
      },
    },
  },
}
