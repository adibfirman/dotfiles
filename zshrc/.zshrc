export EDITOR="nvim"
export SUDO_EDITOR="$EDITOR"

HISTFILE=~/.history
HISTSIZE=10000
SAVEHIST=50000

# import aliases
[ -f ~/.zshrc_aliases ] && source ~/.zshrc_aliases

# import related work file
[ -f ~/.zshrc_work ] && source ~/.zshrc_work

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

# init tmux
if [ "$TMUX" = "" ]; then tmux; fi

# Key bindings for completion menu
zstyle ':completion:*' menu select
bindkey '^[[Z' reverse-menu-complete

# loads plugins zsh
plugins=(
  git
  docker
  npm
)

# init nvm (node version manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# init config for mac os related
if [[ $(uname) == 'Darwin' ]]; then
  # init homebrew
  eval "$(/opt/homebrew/bin/brew shellenv)"
  export CPLUS_INCLUDE_PATH=/opt/homebrew/include

  # export related android path
  export ANDROID_HOME=/Users/$USER/Library/Android/sdk
  export PATH="$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools"
fi

export PATH=$PATH:~/.cargo/bin
export PATH=$PATH:~/.local/share/bob/nvim-bin
