# init tmux
if [ "$TMUX" = "" ]; then tmux; fi

# initialise completions with ZSH's compinit
autoload -Uz compinit && compinit

# Case-insensitive completions
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'

# Better completion UI
zstyle ':completion:*' menu select=2
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"
zstyle ':completion:*' group-name ''
zstyle ':completion:*' rehash true  # Auto-update PATH completions

# Starship prompt
eval "$(starship init zsh)"
eval "$(starship completions zsh)"

export EDITOR="nvim"
export SUDO_EDITOR="$EDITOR"

HISTFILE=~/.history
HISTSIZE=10000
SAVEHIST=50000

# Key bindings for completion menu
zstyle ':completion:*' menu select
bindkey '^[[Z' reverse-menu-complete

plugins=(
  git
  docker
  npm
)
