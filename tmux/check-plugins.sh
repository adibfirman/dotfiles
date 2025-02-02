#!/bin/sh

# Paths
TMUX_CONF="$HOME/.tmux.conf"
TPM_DIR="$HOME/.tmux/plugins/tpm"
PLUGINS_DIR="$HOME/.tmux/plugins"

# Install TPM if missing
if [ ! -d "$TPM_DIR" ]; then
  echo "Installing Tmux Plugin Manager..."
  git clone https://github.com/tmux-plugins/tpm "$TPM_DIR"
fi

# Install plugins using TPM
echo "Installing/updating plugins..."
"$TPM_DIR/bin/install_plugins"

# Check if plugins are properly cloned
echo ""
echo "Checking plugin installation status..."

# Extract plugins from .tmux.conf
PLUGINS=$(grep -E '^[[:space:]]*set -g @plugin' "$TMUX_CONF" | \
  awk -F "'" '{print $2}' | \
  sed 's|https://github.com/||g')  # Handle full URLs if present

# Check each plugin's directory
for PLUGIN in $PLUGINS; do
  # Extract repo name (e.g., "tmux-plugins/tmux-sensible" => "tmux-sensible")
  REPO_NAME=$(basename "$PLUGIN")
  PLUGIN_PATH="$PLUGINS_DIR/$REPO_NAME"

  if [ -d "$PLUGIN_PATH" ]; then
    echo "✓ Installed: $PLUGIN"
  else
    echo "✗ MISSING: $PLUGIN (expected at $PLUGIN_PATH)"
  fi
done

echo "Validation complete."
