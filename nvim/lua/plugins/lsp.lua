local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
end

local function is_node_16()
  local function get_node_version()
    local handle = io.popen("node -v")
    if not (handle == nil) then
      local version = handle:read("*a")
      handle:close()
      return version
    end
  end

  local version = get_node_version()
  local major_version = tonumber(version:match("v(%d+)"))

  if major_version >= 16 then
    return true
  else
    return false
  end
end

-- for now this only used in the project in office that still using vue js
-- will change this root files detection in case there's any new project coming
local function use_volar_takeover_project_over_ts()
  local lspconfig_util = require("lspconfig.util")
  local root_files = {
    "ttam_creation_mono.code-workspace",
  }

  ---@diagnostic disable-next-line: deprecated
  local root_dir = lspconfig_util.root_pattern(unpack(root_files))(vim.fn.getcwd())

  if not root_dir then
    return false
  end

  -- Check each file in the root directory
  local full_path = lspconfig_util.path.join(root_dir, root_files[1])
  if vim.fn.filereadable(full_path) == 1 or vim.fn.isdirectory(full_path) == 1 then
    return true
  end

  return false
end

return {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    setup = function()
      require("nvim-treesitter.config").setup({
        highlight = { enable = true },
        indent = { enable = true },
        auto_install = true,
      })
    end,
  },
  {
    "williamboman/mason.nvim",
    cmd = "Mason",
    build = ":MasonUpdate",
    opts_extend = { "ensure_installed" },
    opts = {
      ensure_installed = {
        "ast-grep",
        "eslint-lsp",
        "eslint_d",
        "harper-ls",
        "lua-language-server",
        "luacheck",
        "luaformatter",
        "prettier",
        "stylua",
        "typescript-language-server",
        "vtsls",
      },
    },
    config = function(_, opts)
      require("mason").setup(opts)
      local mr = require("mason-registry")

      mr:on("package:install:success", function()
        vim.defer_fn(function()
          require("lazy.core.handler.event").trigger({
            event = "FileType",
            buf = vim.api.nvim_get_current_buf(),
          })
        end, 100)
      end)

      -- ensure installed all the package from options "opts.ensure_installed"
      mr.refresh(function()
        for _, tool in ipairs(opts.ensure_installed) do
          local p = mr.get_package(tool)
          if not p:is_installed() then
            p:install()
          end
        end
      end)
    end,
  },
  {
    "zapling/mason-lock.nvim",
    init = function()
      require("mason-lock").setup({
        lockfile_path = vim.fn.stdpath("config") .. "/mason-lock.json",
      })
    end,
  },
  {
    "nvimtools/none-ls.nvim",
    config = function()
      local augroup = vim.api.nvim_create_augroup("LspFormatting", {})
      local null_ls = require("null-ls")

      null_ls.setup({
        sources = {
          null_ls.builtins.formatting.stylua,
          null_ls.builtins.formatting.prettier,
        },
        -- you can reuse a shared lspconfig on_attach callback here
        on_attach = function(client, bufnr)
          if client.supports_method("textDocument/formatting") then
            vim.api.nvim_clear_autocmds({ group = augroup, buffer = bufnr })
            vim.api.nvim_create_autocmd("BufWritePre", {
              group = augroup,
              buffer = bufnr,
              callback = function()
                vim.lsp.buf.format({ bufnr = bufnr, id = client.id })
              end,
            })
          end
        end,
      })
    end,
  },
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
    },
    config = function()
      local lspconfig = require("lspconfig")
      local mason_lspconfig = require("mason-lspconfig")

      -- This will remove buffer permanently if the buffer not longer in the list
      local function buffer_augroup(group, bufnr, cmds)
        vim.api.nvim_create_augroup(group, { clear = false })
        vim.api.nvim_clear_autocmds({ group = group, buffer = bufnr })
        for _, cmd in ipairs(cmds) do
          local event = cmd.event
          cmd.event = nil
          vim.api.nvim_create_autocmd(event, vim.tbl_extend("keep", { group = group, buffer = bufnr }, cmd))
        end
      end

      -- attach this on lsp server in params "on_attach" for each lsp
      local function on_attach(client, bufnr)
        local detach = function()
          vim.lsp.buf_detach_client(bufnr, client.id)
        end
        buffer_augroup("entropitor:lsp:closing", bufnr, {
          { event = "BufDelete", callback = detach },
        })
      end

      mason_lspconfig.setup_handlers({
        ["eslint"] = function()
          lspconfig["eslint"].setup({
            root_dir = get_root_dir,
            -- capabilities = capabilities,
            format = true,
            on_attach = function(client, bufnr)
              on_attach(client, bufnr)
              vim.api.nvim_create_autocmd("BufWritePre", {
                buffer = bufnr,
                command = "EslintFixAll",
              })
            end,
          })
        end,
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({
            filetypes = { "lua" },
            format = true,
            on_attach = on_attach,
          })
        end,
        ["vtsls"] = function()
          local enabled = not use_volar_takeover_project_over_ts()

          if is_node_16() then
            lspconfig["vtsls"].setup({
              -- capabilities = capabilities,
              root_dir = get_root_dir,
              on_attach = on_attach,
              enabled = enabled,
            })
          end
        end,
        ["ts_ls"] = function()
          local enabled = not use_volar_takeover_project_over_ts()

          if is_node_16() == false then
            -- https://github.com/neovim/nvim-lspconfig/pull/3232
            lspconfig["ts_ls"].setup({
              -- capabilities = capabilities,
              root_dir = get_root_dir,
              on_attach = on_attach,
              enabled = enabled,
            })
          end
        end,
      })
    end,
  },
}
