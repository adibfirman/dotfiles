local mc = require("multicursor-nvim")

vim.keymap.set({ "n", "x" }, "<c-d>", function()
  mc.matchAddCursor(1)
end, { desc = "Jump to the next matched word" })
