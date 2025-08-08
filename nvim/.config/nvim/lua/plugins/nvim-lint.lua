return {
  "mfussenegger/nvim-lint",
  branch = "master",
  config = function()
    local lint = require("lint")

    lint.linters.golangcilint = {
      args = {
        "run",
        "--output.json.path=stdout",
        -- Overwrite values possibly set in ".golangci.yml" file
        "--output.text.path=",
        "--output.tab.path=",
        "--output.html.path=",
        "--output.checkstyle.path=",
        "--output.code-climate.path=",
        "--output.junit-xml.path=",
        "--output.teamcity.path=",
        "--output.sarif.path=",
        "--issues-exit-code=0",
        "--show-stats=false",
        function()
          return vim.fn.fnamemodify(vim.api.nvim_buf_get_name(0), ":h")
        end,
      },
    }

    lint.linters_by_ft = {
      css = { "stylelint" },
      go = { "golangcilint" },
      graphql = { "quick-lint-js" },
      html = { "quick-lint-js" },
      javascript = { "quick-lint-js" },
      javascriptreact = { "quick-lint-js" },
      less = { "stylelint" },
      lua = { "luacheck" },
      markdown = { "quick-lint-js" },
      sass = { "stylelint" },
      scss = { "stylelint" },
      svelte = { "quick-lint-js" },
      typescript = { "quick-lint-js" },
      typescriptreact = { "quick-lint-js" },
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
