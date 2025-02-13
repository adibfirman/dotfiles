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

## Prerequisites 🛠️
- Git
- [Nerd Font](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/CascadiaCode.zip)
- GNU Stow `brew install stow` or `yay -S stow`
- ZSH `brew install zsh` or `yay -S zsh`
- Starship `brew install starship` or `yay -S starship`
- Neovim ≥ 0.10.0
- lua
- [FZF](https://github.com/junegunn/fzf?tab=readme-ov-file#installation)
- [Lazygit](https://github.com/jesseduffield/lazygit)
- [luarocks](https://github.com/luarocks/luarocks)
- [fd](https://github.com/sharkdp/fd)
- Ripgrep `brew install ripgrep` or `yay -S ripgrep`
- Stylua `brew install stylua` or `yay -S stylua`

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

Then, you need to trigger by calling `lazygit` outside the neovim mode then you can reopen the neovim and lazy git will opened like charm
