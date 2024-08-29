return {
  {
    "nvimdev/dashboard-nvim",
    event = "VimEnter",
    opts = function(_, opts)
      local logo = [[
        ██████╗ ██╗██████╗ ██╗    ██╗███████╗██████╗ 
        ██╔══██╗██║██╔══██╗██║    ██║██╔════╝██╔══██╗
        ██║  ██║██║██████╔╝██║ █╗ ██║█████╗  ██████╔╝
        ██║  ██║██║██╔══██╗██║███╗██║██╔══╝  ██╔══██╗
        ██████╔╝██║██████╔╝╚███╔███╔╝███████╗██████╔╝
        ╚═════╝ ╚═╝╚═════╝  ╚══╝╚══╝ ╚══════╝╚═════╝ 
    ]]

      logo = string.rep("\n", 8) .. logo .. "\n\n"
      opts.config.header = vim.split(logo, "\n")
    end,
  },
  {
    "folke/noice.nvim",
    opts = function(_, opts)
      table.insert(opts.routes, {
        filter = {
          event = "notify",
          find = "No information available",
        },
        opts = { skip = true },
      })

      table.insert(opts.routes, {
        filter = {
          event = "notify",
          find = " ",
        },
        opts = { skip = true },
      })

      opts.presets.lsp_doc_border = true
    end,
  },
  {
    "rcarriga/nvim-notify",
    config = function()
      require("notify").setup({
        background_colour = "NotifyBackground",
        minimum_width = 50,
        render = "minimal",
        stages = "slide",
        top_down = true,
        timeout = 10000,
      })
    end,
  },
}
