return {
  "mfussenegger/nvim-lint",
  config = function()
    local lint = require("lint")
    lint.linters_by_ft = {
      javascript = { "eslint_d" },
      typescript = { "eslint_d" },
      javascriptreact = { "eslint_d" },
      typescriptreact = { "eslint_d" },
      svelte = { "eslint_d" },
      css = { "eslint_d" },
      html = { "eslint_d" },
      markdown = { "eslint_d" },
      graphql = { "eslint_d" },
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
