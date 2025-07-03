return {
  "ibhagwan/fzf-lua",
  cmd = "FzfLua",
  dependencies = {
    "nvim-tree/nvim-web-devicons",
  },
  opts = {
    "default-title",
    files = {
      cwd_prompt = false,
    },
    winopts = {
      height = 0.85,
      width = 0.80,
      row = 0.15,
      col = 0.50,
      preview = {
        layout = "vertical",
        vertical = "up:65%",
      },
    },
    fzf_opts = {
      ["--layout"] = "reverse",
      -- ["--info"] = "inline",
    },
  },
  config = function(_, opts)
    if opts[1] == "default-title" then
      local function fix(t)
        t.prompt = t.prompt ~= nil and " " or nil
        for _, v in pairs(t) do
          if type(v) == "table" then
            fix(v)
          end
        end
        return t
      end
      opts = vim.tbl_deep_extend("force", fix(require("fzf-lua.profiles.default-title")), opts)
      opts[1] = nil
    end
    require("fzf-lua").setup(opts)
  end,
}
