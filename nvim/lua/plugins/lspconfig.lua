local get_root_dir = function(fname)
  local util = require("lspconfig.util")
  return util.root_pattern(".git")(fname) or util.root_pattern("package.json", "tsconfig.json")(fname)
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
    opts = {
      document_highlight = {
        enabled = true,
      },
    },
    -- opts = {
    --   servers = {
    --     eslint = {
    --       root_dir = get_root_dir,
    --       format = true,
    --       quiet = false,
    --     },
    --     tailwindcss = {
    --       root_dir = function(fname)
    --         local lsp_util = require("lspconfig.util")
    --         return lsp_util.root_pattern("tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs")(fname)
    --       end,
    --     },
    --     tsserver = {
    --       root_dir = get_root_dir,
    --     },
    --     vtsls = {
    --       root_dir = get_root_dir,
    --     },
    --   },
    --   setup = {
    --     -- eslint = function()
    --     --   require("lazyvim.util").lsp.on_attach(function(client)
    --     --     if client.name == "eslint" then
    --     --       client.server_capabilities.documentFormattingProvider = true
    --     --     elseif client.name == "tsserver" or client.name == "vtsls" then
    --     --       client.server_capabilities.documentFormattingProvider = false
    --     --     end
    --     --   end)
    --     -- end,
    --     tsserver = function()
    --       local function get_node_version()
    --         local handle = io.popen("node -v")
    --         if not (handle == nil) then
    --           local version = handle:read("*a")
    --           handle:close()
    --           return version
    --         end
    --       end
    --
    --       local function is_node_version_greater_than_16()
    --         local version = get_node_version()
    --         local major_version = tonumber(version:match("v(%d+)"))
    --
    --         if major_version > 16 then
    --           return true
    --         else
    --           return false
    --         end
    --       end
    --
    --       require("lazyvim.util").lsp.on_attach(function(client)
    --         if client.name == "tsserver" then
    --           if is_node_version_greater_than_16() then
    --             client.stop(true)
    --           end
    --         end
    --       end)
    --     end,
    --   },
    -- },
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

      local function get_node_version()
        local handle = io.popen("node -v")
        if not (handle == nil) then
          local version = handle:read("*a")
          handle:close()
          return version
        end
      end

      local function is_node_16()
        local version = get_node_version()
        local major_version = tonumber(version:match("v(%d+)"))

        if major_version > 16 then
          return true
        else
          return false
        end
      end

      mason_lspconfig.setup_handlers({
        -- uncomment this if you want to automatic detect all the server name
        -- function(server_name)
        --   lspconfig[server_name].setup({
        --     capabilities = capabilities,
        --   })
        -- end,
        ["eslint"] = function()
          lspconfig["eslint"].setup({
            capabilities = capabilities,
            format = true,
            quiet = false,
            root_dir = get_root_dir,
            on_attach = function(_, bufnr)
              vim.api.nvim_create_autocmd("BufWritePre", {
                buffer = bufnr,
                command = "EslintFixAll",
              })
            end,
          })
        end,
        ["tsserver"] = function()
          if is_node_16() == false then
            lspconfig["tsserver"].setup({
              capabilities = capabilities,
              root_dir = get_root_dir,
            })
          end
        end,
        ["vtsls"] = function()
          if is_node_16() then
            lspconfig["vtsls"].setup({
              capabilities = capabilities,
              root_dir = get_root_dir,
            })
          end
        end,
        ["lua_ls"] = function()
          lspconfig["lua_ls"].setup({})
        end,
      })
    end,
  },
}
