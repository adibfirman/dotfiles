#!/bin/bash

# Skill Sync Script
# Syncs local skills folder with GitHub repositories
# Usage: ./sync-skills.sh

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/skills-config.json"
LOCK_FILE="/tmp/sync-skills.lock"
TEMP_DIR_PREFIX="/tmp/sync-skills"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track results
declare -a SUCCESS_SKILLS=()
declare -a FAILED_SKILLS=()

# Cleanup function
cleanup() {
    if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
    fi
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Remove lock file on exit
remove_lock() {
    rm -f "$LOCK_FILE"
}
trap remove_lock EXIT

# Check if script is already running
check_lock() {
    if [[ -f "$LOCK_FILE" ]]; then
        local pid
        pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            echo -e "${RED}Error: Sync script is already running (PID: $pid)${NC}"
            exit 1
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    if ! command -v git &> /dev/null; then
        missing_deps+=("git")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing_deps+=("jq")
    fi
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        echo -e "${RED}Error: Missing required dependencies:${NC}"
        printf '  - %s\n' "${missing_deps[@]}"
        echo ""
        echo "Install with:"
        [[ " ${missing_deps[*]} " =~ " jq " ]] && echo "  brew install jq    # macOS"
        [[ " ${missing_deps[*]} " =~ " jq " ]] && echo "  apt-get install jq # Ubuntu/Debian"
        exit 1
    fi
}

# Validate config file exists
validate_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        echo -e "${RED}Error: Config file not found: $CONFIG_FILE${NC}"
        echo "Create it with your skill mappings."
        exit 1
    fi
    
    if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
        echo -e "${RED}Error: Invalid JSON in config file: $CONFIG_FILE${NC}"
        exit 1
    fi
}

# Parse GitHub URL to extract components
parse_github_url() {
    local url="$1"
    local owner repo
    
    # Remove .git suffix if present
    url="${url%.git}"
    
    # Extract owner and repo from GitHub URL
    if [[ "$url" =~ github.com/([^/]+)/([^/]+) ]]; then
        owner="${BASH_REMATCH[1]}"
        repo="${BASH_REMATCH[2]}"
        echo "$owner $repo"
    else
        echo ""
    fi
}

# Sync a single skill
sync_skill() {
    local name="$1"
    local source="$2"
    local path="$3"
    local branch="$4"
    local local_path="$SCRIPT_DIR/$name"
    
    echo -e "${BLUE}Syncing: $name${NC}"
    
    # Parse GitHub URL
    local parsed
    parsed=$(parse_github_url "$source")
    if [[ -z "$parsed" ]]; then
        echo -e "${RED}  ✗ Invalid GitHub URL: $source${NC}"
        FAILED_SKILLS+=("$name (invalid URL)")
        return 1
    fi
    
    local owner repo
    read -r owner repo <<< "$parsed"
    
    # Create temp directory
    TEMP_DIR="${TEMP_DIR_PREFIX}-${name}-$$"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    
    # Clone with sparse-checkout
    if ! git clone \
        --depth 1 \
        --filter=blob:none \
        --sparse \
        --branch "$branch" \
        "$source" \
        "$TEMP_DIR" 2>&1 | sed 's/^/  /'; then
        echo -e "${RED}  ✗ Failed to clone repository${NC}"
        FAILED_SKILLS+=("$name (clone failed)")
        return 1
    fi
    
    # Configure sparse-checkout
    (cd "$TEMP_DIR"
    if ! git sparse-checkout set "$path" 2>&1 | sed 's/^/  /'; then
        echo -e "${RED}  ✗ Failed to configure sparse-checkout${NC}"
        FAILED_SKILLS+=("$name (sparse-checkout failed)")
        return 1
    fi
    
    # Checkout the files
    if ! git checkout 2>&1 | sed 's/^/  /'; then
        echo -e "${RED}  ✗ Failed to checkout files${NC}"
        FAILED_SKILLS+=("$name (checkout failed)")
        return 1
    fi
    )
    
    # Check if skill directory exists in temp
    if [[ ! -d "$TEMP_DIR/$path" ]]; then
        echo -e "${RED}  ✗ Skill path not found in repository: $path${NC}"
        FAILED_SKILLS+=("$name (path not found)")
        return 1
    fi
    
    # Remove existing local skill directory (true sync)
    if [[ -d "$local_path" ]]; then
        echo -e "${YELLOW}  → Removing existing local directory${NC}"
        rm -rf "$local_path"
    fi
    
    # Move new files to destination
    echo -e "${YELLOW}  → Installing new version${NC}"
    mkdir -p "$(dirname "$local_path")"
    mv "$TEMP_DIR/$path" "$local_path"
    
    # Cleanup temp
    rm -rf "$TEMP_DIR"
    TEMP_DIR=""
    
    echo -e "${GREEN}  ✓ Successfully synced $name${NC}"
    SUCCESS_SKILLS+=("$name")
    return 0
}

# Main sync process
main() {
    echo -e "${BLUE}=== Skill Sync Script ===${NC}"
    echo ""
    
    # Check lock
    check_lock
    
    # Check dependencies
    check_dependencies
    
    # Validate config
    validate_config
    
    # Count total skills
    local total
    total=$(jq '.skills | length' "$CONFIG_FILE")
    
    echo "Found $total skill(s) to sync"
    echo ""
    
    # Process each skill
    local i=0
    while IFS= read -r skill; do
        i=$((i + 1))
        
        local name source path branch
        name=$(echo "$skill" | jq -r '.name')
        source=$(echo "$skill" | jq -r '.source')
        path=$(echo "$skill" | jq -r '.path')
        branch=$(echo "$skill" | jq -r '.branch // "main"')
        
        echo "[$i/$total] Syncing skill: $name"
        sync_skill "$name" "$source" "$path" "$branch"
        echo ""
        
    done < <(jq -c '.skills[]' "$CONFIG_FILE")
    
    # Print summary
    echo -e "${BLUE}=== Sync Summary ===${NC}"
    echo ""
    
    if [[ ${#SUCCESS_SKILLS[@]} -gt 0 ]]; then
        echo -e "${GREEN}Successfully synced (${#SUCCESS_SKILLS[@]}):${NC}"
        printf '  ✓ %s\n' "${SUCCESS_SKILLS[@]}"
        echo ""
    fi
    
    if [[ ${#FAILED_SKILLS[@]} -gt 0 ]]; then
        echo -e "${RED}Failed to sync (${#FAILED_SKILLS[@]}):${NC}"
        printf '  ✗ %s\n' "${FAILED_SKILLS[@]}"
        echo ""
        exit 1
    else
        echo -e "${GREEN}All skills synced successfully!${NC}"
    fi
}

# Show help
show_help() {
    cat << 'EOF'
Skill Sync Script

Syncs local skills folder with GitHub repositories.

USAGE:
    ./sync-skills.sh [OPTIONS]

OPTIONS:
    -h, --help      Show this help message

CONFIGURATION:
    Edit skills-config.json to configure which skills to sync.

EXAMPLE:
    cd /Users/cataengineer/dotfiles/claude/.claude/skills/
    ./sync-skills.sh

CONFIG FILE FORMAT:
    {
      "skills": [
        {
          "name": "skill-name",
          "source": "https://github.com/owner/repo",
          "path": "path/to/skill/in/repo",
          "branch": "main"
        }
      ]
    }
EOF
}

# Parse arguments
if [[ $# -gt 0 ]]; then
    case "$1" in
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Error: Unknown option: $1${NC}"
            echo "Use -h or --help for usage information."
            exit 1
            ;;
    esac
fi

# Run main
main
