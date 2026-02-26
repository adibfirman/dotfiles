# Dotfiles

My cross-platform development environment setup — consistent across macOS and Linux.

## Table of Contents

- [Overview](#overview)
- [What's Included](#whats-included)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Component Setup](#component-setup)
- [FAQ & Troubleshooting](#faq--troubleshooting)

## Overview

This repository contains system configurations managed with [GNU Stow](https://www.gnu.org/software/stow/) for symlink management. Designed to work seamlessly on both macOS and Linux (Arch-based distributions).

## What's Included

| Component | Configuration |
|-----------|---------------|
| **Editor** | Neovim (Lua-based config with Lazy.nvim) |
| **Terminal** | Ghostty, Alacritty |
| **Shell** | Zsh + Zinit plugin manager |
| **Prompt** | Starship |
| **Multiplexer** | Tmux + TPM |
| **AI Assistant** | OpenCode, Claude skills |

## Prerequisites

### Core Tools

| Tool | macOS | Arch Linux | Purpose |
|------|-------|------------|---------|
| Git | Pre-installed | `pacman -S git` | Version control |
| GNU Stow | `brew install stow` | `yay -S stow` | Symlink management |
| Zsh | `brew install zsh` | `yay -S zsh` | Shell |
| [Kode Mono Font](https://fonts.google.com/specimen/Kode+Mono) | Manual install | Manual install | Terminal font |

### Terminal & Shell

| Tool | macOS | Arch Linux |
|------|-------|------------|
| Starship | `brew install starship` | `yay -S starship` |
| Tmux | `brew install tmux` | `yay -S tmux` |
| FZF | `brew install fzf` | `yay -S fzf` |
| Ripgrep | `brew install ripgrep` | `yay -S ripgrep` |
| fd | `brew install fd` | `yay -S fd` |

### Development Tools

| Tool | Installation | Notes |
|------|--------------|-------|
| [Bob (Neovim version manager)](https://github.com/MordechaiHadad/bob) | `cargo install bob-nvim` | Install Rust/Cargo first |
| Tree-sitter | `brew install tree-sitter` / `yay -S tree-sitter` | Required for Neovim |
| Lua | `brew install lua` / `yay -S lua` | Scripting |
| Luarocks | [GitHub](https://github.com/luarocks/luarocks) | Lua package manager |
| Stylua | `brew install stylua` / `yay -S stylua` | Lua formatter |
| CMake | `brew install cmake` / `yay -S cmake` | Build tool |

### Version Managers

| Tool | Installation |
|------|--------------|
| [NVM](https://github.com/nvm-sh/nvm) (Node) | curl script or package manager |
| [GVM](https://github.com/moovweb/gvm) (Go) | curl script |

### Git & Docker Tools

| Tool | macOS | Arch Linux |
|------|-------|------------|
| [Lazygit](https://github.com/jesseduffield/lazygit) | `brew install lazygit` | `yay -S lazygit` |
| [Lazydocker](https://github.com/jesseduffield/lazydocker) | `brew install lazydocker` | `yay -S lazydocker` |
| Colima | `brew install colima` | — | Docker Desktop alternative for macOS |

### Additional Tools

| Tool | Installation | Purpose |
|------|--------------|---------|
| [OpenCode](https://opencode.ai/) | See website | AI coding assistant |
| Tectonic | `yay -S tectonic` | LaTeX engine |
| Mermaid CLI | `pnpm add -g @mermaid-js/mermaid-cli` | Diagram generation |
| ImageMagick | `brew install imagemagick` / `yay -S imagemagick` | Image processing |
| xclip | `sudo apt install xclip` | Clipboard support (Linux) |

## Installation

```bash
# Clone repository
git clone https://github.com/yourusername/dotfiles.git ~/.dotfiles
cd ~/.dotfiles

# Stow individual components
stow nvim
stow zshrc
stow tmux
stow ghostty
stow starship
# etc.

# Or stow all at once
stow */
```

## Component Setup

### Neovim

```bash
# Install Neovim via Bob (requires Rust/Cargo)
cargo install bob-nvim
bob install 0.11.2
```

### Tmux

After installing `tmux`, run the plugin installation script:

```bash
./tmux/check-plugins.sh
```

This installs TPM (Tmux Plugin Manager) and all configured plugins.

### Zsh

The Zsh configuration uses [Zinit](https://github.com/zdharma-continuum/zinit) for plugin management. It will auto-install on first shell startup.

## Directory Structure

```
.
├── alacritty/      # Alacritty terminal config
├── bashrc/         # Bash configuration
├── claude/         # Claude skills and configuration
├── ghostty/        # Ghostty terminal config
├── nvim/           # Neovim Lua configuration
├── opencode/       # OpenCode configuration
├── starship/       # Starship prompt config
├── tmux/           # Tmux configuration + plugin installer
└── zshrc/          # Zsh configuration + aliases
```

## FAQ & Troubleshooting

### Q1: Lazygit exits with error code inside Neovim

**Solution:** First run `lazygit` directly in the terminal (outside Neovim) to initialize its configuration, then it will work inside Neovim.

### Q2: Paste (Ctrl+P) doesn't work on Linux

**Solution:** Install clipboard support:

```bash
# Debian/Ubuntu
sudo apt install xclip

# Arch
yay -S xclip
```

### Q3: Neovim treesitter parsers fail to compile

**Solution:** Ensure `tree-sitter` CLI and `gcc/clang` are installed:

```bash
# macOS
brew install tree-sitter
xcode-select --install

# Arch
yay -S tree-sitter base-devel
```
