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

-- if the repo using lerna or something for monorepo purpose
-- we need to attach the root_dir LSP to the root of repo instead of per service/apps
local function is_using_monorepo()
  local lspconfig_util = require("lspconfig.util")
  local root_files = {
    "lerna.json",
  }

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

-- for now this only used in the project in office that still using vue js
-- will change this root files detection in case there's any new project coming
local function use_volar_takeover_project_over_ts()
  local lspconfig_util = require("lspconfig.util")
  local root_files = {
    "ttam_creation_mono.code-workspace",
  }

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
    "williamboman/mason.nvim",
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
    "neovim/nvim-lspconfig",
    dependencies = {
      "hrsh7th/cmp-nvim-lsp",
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
    },
    config = function(_, opts)
      local lspconfig = require("lspconfig")
      local mason_lspconfig = require("mason-lspconfig")
      local cmp_nvim_lsp = require("cmp_nvim_lsp")

      LazyVim.format.register(LazyVim.lsp.formatter()) -- setup auto formatter
      LazyVim.lsp.on_attach(function(client, buffer) -- get the existing keymaps from lazyvim
        require("lazyvim.plugins.lsp.keymaps").on_attach(client, buffer)
      end)

      LazyVim.lsp.words.setup(opts.document_highlight)

      -- used to enable autocompletion (assign to every lsp server config)
      local capabilities = cmp_nvim_lsp.default_capabilities()

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
        -- uncomment this if you want to automatic detect all the server name
        -- function(server_name)
        --   lspconfig[server_name].setup({
        --     capabilities = capabilities,
        --   })
        -- end,
        ["eslint"] = function()
          local config = {
            capabilities = capabilities,
            format = true,
            on_attach = function(client, bufnr)
              on_attach(client, bufnr)
              vim.api.nvim_create_autocmd("BufWritePre", {
                buffer = bufnr,
                command = "EslintFixAll",
              })
            end,
          }

          if is_using_monorepo() then
            table.insert(config, { root_dir = get_root_dir })
          end

          lspconfig["eslint"].setup(config)
        end,
        ["ts_ls"] = function()
          local enabled = not use_volar_takeover_project_over_ts()

          if is_node_16() == false then
            -- https://github.com/neovim/nvim-lspconfig/pull/3232
            lspconfig["ts_ls"].setup({
              capabilities = capabilities,
              root_dir = get_root_dir,
              on_attach = on_attach,
              enabled = enabled,
            })
          end
        end,
        ["vtsls"] = function()
          local enabled = not use_volar_takeover_project_over_ts()

          if is_node_16() then
            lspconfig["vtsls"].setup({
              capabilities = capabilities,
              root_dir = get_root_dir,
              on_attach = on_attach,
              enabled = enabled,
            })
          end
        end,
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({
            capabilities = capabilities,
            on_attach = on_attach,
          })
        end,
        ["jsonls"] = function()
          lspconfig["jsonls"].setup({
            capabilities = capabilities,
            on_attach = on_attach,
          })
        end,
        ["volar"] = function()
          local enabled = use_volar_takeover_project_over_ts()

          lspconfig["volar"].setup({
            filetypes = { "typescript", "javascript", "javascriptreact", "typescriptreact", "vue", "json" },
            capabilities = capabilities,
            on_attach = on_attach,
            enabled = enabled,
          })
        end,
      })
    end,
  },
}
