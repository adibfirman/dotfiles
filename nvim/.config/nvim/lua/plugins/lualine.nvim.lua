return {
  "nvim-lualine/lualine.nvim",
  event = "VeryLazy",
  branch = "master",
  opts = {
    options = {
      theme = "auto",
      component_separators = "",
      section_separators = { right = "", left = "" },
      globalstatus = true,
    },
    -- ----- reference position ------
    -- +-------------------------------------------------+
    -- | A | B | C                             X | Y | Z |
    -- +-------------------------------------------------+
    sections = {
      lualine_a = {
        {
          "mode",
          separator = { right = "" },
          padding = { left = 1 },
          fmt = function(res)
            return res:sub(1, 1)
          end,
        },
      },
      lualine_b = { "branch" },
      lualine_c = {
        "diff",
        "diagnostic",
      },
      lualine_x = {
        {
          "lsp_status",
          separator = { left = "" },
          color = { bg = "#414550" },
        },
      },
      lualine_y = { "filetype", "progress" },
      lualine_z = {
        { "location", padding = { right = 1 } },
      },
    },
    tabline = {},
    winbar = {},
    extensions = {},
  },
}
