return {
  "mfussenegger/nvim-lint",
  branch = "master",
  config = function()
    local lint = require("lint")
    lint.linters_by_ft = {
      css = { "eslint_d" },
      go = { "golangci_lint" },
      graphql = { "eslint_d" },
      html = { "eslint_d" },
      javascript = { "eslint_d" },
      javascriptreact = { "eslint_d" },
      markdown = { "eslint_d" },
      svelte = { "eslint_d" },
      typescript = { "eslint_d" },
      typescriptreact = { "eslint_d" },
      vue = { "eslint_d" },
    }

    local lint_group = vim.api.nvim_create_augroup("list", { clear = true })
    vim.api.nvim_create_autocmd({ "BufWritePost", "BufRead" }, {
      group = lint_group,
      callback = function()
        require("lint").try_lint(nil, { ignore_errors = true })
      end,
    })
  end,
}
