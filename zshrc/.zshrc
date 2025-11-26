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
if command -v tmux >/dev/null 2>&1; then
  if [ -z "$TMUX" ]; then
    tmux attach || tmux new
  fi
else
  echo "⚠️ tmux is not installed. Please install it first (e.g., 'sudo pacman -S tmux' or 'sudo apt install tmux')."
fi

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
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm


# init config for mac os related
if [[ $(uname) == 'Darwin' ]]; then
  # init homebrew
  eval "$(/opt/homebrew/bin/brew shellenv)"
  export CPLUS_INCLUDE_PATH=/opt/homebrew/include

  # export related android path
  export ANDROID_HOME=/Users/$USER/Library/Android/sdk
  export PATH="$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools"

  export CPPFLAGS="-I/opt/homebrew/opt/openjdk@17/include"
  export PATH="/opt/homebrew/opt/openjdk@17/bin:$PATH"
else
  # Android Stuff on Linux
  export ANDROID_HOME=/opt/android-sdk
  export PATH=$ANDROID_HOME/tools/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH
  # End
fi

export PATH=$PATH:~/.cargo/bin
export PATH=$PATH:~/.local/share/bob/nvim-bin

# GoLang Stuff
export GOPATH="$HOME/go"
export PATH="$PATH:$GOPATH/bin"
[[ -s "$HOME/.gvm/scripts/gvm" ]] && source "$HOME/.gvm/scripts/gvm"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end

# Local Bin
export PATH="$HOME/.local/bin:$PATH"

# Added by Antigravity
export PATH="$HOME/.antigravity/antigravity/bin:$PATH"
