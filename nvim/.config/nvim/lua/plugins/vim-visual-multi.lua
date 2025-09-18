return {
  "mg979/vim-visual-multi",
  branch = "master",
  init = function() -- don't move this into "config" we need to overwrite before the plugins load
    vim.g.VM_default_mappings = 0
    vim.g.VM_insert_mappings = 0
    vim.g.VM_maps = {
      ["Find Under"] = "<C-d>",
      ["Find Subword Under"] = "<C-d>",
      ["i_<CR>"] = "", -- disable VM's <CR> in insert mode
      ["i_<Tab>"] = "", -- disable VM's <Tab> in insert mode
    }
  end,
}
