return {
  "mfussenegger/nvim-lint",
  config = function()
    local lint = require("lint")
    lint.linters_by_ft = {
      javascript = { "quick-lint-js" },
      typescript = { "quick-lint-js" },
      javascriptreact = { "quick-lint-js" },
      typescriptreact = { "quick-lint-js" },
      svelte = { "quick-lint-js" },
      css = { "quick-lint-js" },
      html = { "quick-lint-js" },
      markdown = { "quick-lint-js" },
      graphql = { "quick-lint-js" },
      vue = { "quick-lint-js" },
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
