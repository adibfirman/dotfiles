# Dotfiles 🖥️

**My cross-platform development environment setup**  
*Consistent across macOS and Linux*

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Overview 🔍

This repository contains my system configurations for:
- **Editor**: Neovim (Lua config)
- **Terminal**: Ghostty, Alacritty
- **Shell**: Oh My Zsh, Starship, Tmux

Designed to work seamlessly on both **macOS** and **Linux**.

## Neovim Installation
```bash
# Make sure to install cargo first
# https://github.com/MordechaiHadad/bob
cargo install bob-nvim
bob install 0.10.4
```

## Prerequisites 🛠️
- Git
- [Nerd Font](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/CascadiaCode.zip)
- GNU Stow `brew install stow` or `yay -S stow`
- ZSH `brew install zsh` or `yay -S zsh`
- Starship `brew install starship` or `yay -S starship`
- Tree-sitter `brew install tree-sitter` or `yay -S tree-sitter`
- lua
- [FZF](https://github.com/junegunn/fzf?tab=readme-ov-file#installation)
- [Lazygit](https://github.com/jesseduffield/lazygit)
- [luarocks](https://github.com/luarocks/luarocks)
- [fd](https://github.com/sharkdp/fd)
- Ripgrep `brew install ripgrep` or `yay -S ripgrep`
- Stylua `brew install stylua` or `yay -S stylua`
- cmake `brew install cmake` or `yay -S cmake`

## Installation ⚡
```bash
git clone https://github.com/yourusername/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
stow <folder name>
```

## TMUX Installation
After you install the `tmux` in your system, don't forget to apply the plugins by running the shell script under the `./tmux` folder

## FAQ & Troubleshooting ❓
### Q1: lazygit not working "exit code xx" inside the neovim

You need to trigger by calling `lazygit` directly in the terminal (not inside neoivm).

### Q2: when pressing "p" (paste) does not work in Linux

You need to install `xclip` first `sudo apt install xclip`
