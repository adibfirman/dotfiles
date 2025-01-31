# Dotfiles 🖥️

**My cross-platform development environment setup**  
*Consistent across macOS and Linux*

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## Overview 🔍

This repository contains my system configurations for:
- **Editor**: Neovim (Lua config)
- **Terminal**: Ghostty

Designed to work seamlessly on both **macOS** and **Linux**.

## Prerequisites 🛠️
- Git
- [Nerd Font](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/CascadiaCode.zip)
- GNU Stow (`brew install stow` or `yay -S stow`)
- Neovim (≥ 0.10.0)
- fzf
- lazygit
- luarocks
- lua
- [fd](https://github.com/sharkdp/fd)

## Installation ⚡
```bash
git clone https://github.com/yourusername/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
stow <dot files name>
```
