return {
  "stevearc/conform.nvim",
  event = { "BufWritePre" },
  dependencies = { "mason.nvim" },
  lazy = true,
  cmd = "ConformInfo",
  config = function()
    require("conform").setup({
      formatters_by_ft = {
        astro = { "prettier", stop_after_first = true },
        css = { "prettierd", "prettier", stop_after_first = true },
        graphql = { "prettierd", "prettier", stop_after_first = true },
        html = { "prettierd", "prettier", stop_after_first = true },
        javascript = { "prettierd", "prettier", stop_after_first = true },
        javascriptreact = { "prettierd", "prettier", stop_after_first = true },
        lua = { "stylua" },
        markdown = { "prettierd", "prettier", stop_after_first = true },
        svelte = { "prettierd", "prettier", stop_after_first = true },
        typescript = { "prettierd", "prettier", stop_after_first = true },
        typescriptreact = { "prettierd", "prettier", stop_after_first = true },
        vue = { "prettierd", "prettier", stop_after_first = true },
      },
      format_on_save = function(bufnr)
        if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
          return
        end

        return {
          async = false,
          lsp_format = "fallback",
        }
      end,
    })
  end,
}
