#!/usr/bin/env bash

# Dotfiles Prerequisites Checker
# Cross-platform prerequisite installation checker for macOS and Linux

set -e

# ============================================
# COLORS
# ============================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ============================================
# GLOBALS
# ============================================
OS=""
PKG_MGR=""
AUTO_CONFIRM=false
SKIP_LIST=()

# Tool definitions: "Display Name|command_name|check_version_flag"
TOOLS=(
    "Git|git|--version"
    "GNU Stow|stow|--version"
    "Zsh|zsh|--version"
    "Starship|starship|--version"
    "Tmux|tmux|-V"
    "FZF|fzf|--version"
    "Ripgrep|rg|--version"
    "fd|fd|--version"
    "Cargo|cargo|--version"
    "Bob|bob|--version"
    "UV|uv|--version"
    "UVX|uvx|--version"
    "Neovim|nvim|--version"
    "Tree-sitter|tree-sitter|--version"
    "Lua|lua|-v"
    "Luarocks|luarocks|--version"
    "Stylua|stylua|--version"
    "CMake|cmake|--version"
    "NVM|nvm|--version"
    "GVM|gvm|version"
    "Lazygit|lazygit|--version"
    "Lazydocker|lazydocker|--version"
    "Colima|colima|--version"
    "OpenCode|opencode|--version"
    "Tectonic|tectonic|--version"
    "Mermaid CLI|mmdc|--version"
    "ImageMagick|convert|--version"
    "xclip|xclip|-version"
)

TOTAL_CHECKS=0
PASSED=0
FAILED=0
SKIPPED=0
MANUAL=0

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${BOLD}========================================${NC}"
    echo ""
}

print_step() {
    echo -e "${CYAN}----------------------------------------${NC}"
    echo -e "${BOLD}$1${NC}"
    echo -e "${CYAN}----------------------------------------${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# ============================================
# OS DETECTION
# ============================================

detect_os() {
    case "$(uname -s)" in
        Darwin*)
            OS="macos"
            PKG_MGR="brew"
            ;;
        Linux*)
            if [ -f /etc/arch-release ]; then
                OS="arch"
                PKG_MGR="yay"
            elif [ -f /etc/debian_version ]; then
                OS="debian"
                PKG_MGR="apt"
            else
                print_error "Unsupported Linux distribution"
                exit 2
            fi
            ;;
        *)
            print_error "Unsupported operating system: $(uname -s)"
            exit 2
            ;;
    esac
    
    print_info "Detected OS: $(uname -s)"
    print_info "Package Manager: $PKG_MGR"
    echo ""
}

# ============================================
# SUDO VALIDATION
# ============================================

validate_sudo() {
    print_warning "This script requires sudo access to install system packages."
    
    if [ "$AUTO_CONFIRM" = false ]; then
        read -rp "Continue with sudo access? (Y/n): " response
        if [[ "$response" =~ ^[Nn]$ ]]; then
            print_error "Sudo access required. Exiting."
            exit 1
        fi
    fi
    
    # Validate sudo
    if ! sudo -v; then
        print_error "Failed to validate sudo access"
        exit 1
    fi
    
    print_success "Sudo access validated"
    echo ""
}

# ============================================
# YAY INSTALLATION (Arch only)
# ============================================

install_yay_if_needed() {
    if [ "$OS" != "arch" ]; then
        return 0
    fi
    
    if command -v yay >/dev/null 2>&1; then
        PKG_MGR="yay"
        print_success "yay found"
        return 0
    fi
    
    print_warning "yay not found. Installing yay first..."
    
    # Install dependencies
    sudo pacman -S --needed --noconfirm git base-devel || {
        print_error "Failed to install yay dependencies"
        exit 1
    }
    
    # Clone and build yay
    local yay_tmp="/tmp/yay-install-$$"
    git clone https://aur.archlinux.org/yay.git "$yay_tmp" || {
        print_error "Failed to clone yay repository"
        exit 1
    }
    
    (cd "$yay_tmp" && makepkg -si --noconfirm) || {
        print_error "Failed to build and install yay"
        rm -rf "$yay_tmp"
        exit 1
    }
    
    rm -rf "$yay_tmp"
    PKG_MGR="yay"
    print_success "yay installed successfully"
    echo ""
}

# ============================================
# INTERACTIVE SKIP MENU
# ============================================

show_toggle_menu() {
    local -a selected=()
    local current=0
    local total=${#TOOLS[@]}
    local confirm_selected=false
    
    # Initialize all as not selected (0)
    for ((i=0; i<total; i++)); do
        selected[$i]=0
    done
    
    # Hide cursor
    tput civis 2>/dev/null || true
    
    while true; do
        clear 2>/dev/null || printf "\033[2J\033[H"
        
        echo -e "${BLUE}Use arrow keys to navigate, SPACE to toggle, ENTER to confirm:${NC}"
        echo ""
        
        # Calculate column width
        local mid=$(( (total + 1) / 2 ))
        
        # Display in two columns
        for ((i=0; i<mid; i++)); do
            local left_idx=$i
            local right_idx=$((i + mid))
            
            # Left column
            local left_tool="${TOOLS[$left_idx]}"
            local left_name="${left_tool%%|*}"
            local left_mark="[ ]"
            [ "${selected[$left_idx]}" -eq 1 ] && left_mark="[x]"
            
            if [ "$left_idx" -eq "$current" ]; then
                printf "> ${GREEN}%s${NC} %-20s " "$left_mark" "$left_name"
            else
                printf "  %s %-20s " "$left_mark" "$left_name"
            fi
            
            # Right column (if exists)
            if [ "$right_idx" -lt "$total" ]; then
                local right_tool="${TOOLS[$right_idx]}"
                local right_name="${right_tool%%|*}"
                local right_mark="[ ]"
                [ "${selected[$right_idx]}" -eq 1 ] && right_mark="[x]"
                
                if [ "$right_idx" -eq "$current" ]; then
                    printf "> ${GREEN}%s${NC} %-20s" "$right_mark" "$right_name"
                else
                    printf "  %s %-20s" "$right_mark" "$right_name"
                fi
            fi
            
            echo ""
        done
        
        echo ""
        if [ "$confirm_selected" = true ]; then
            echo -e "${GREEN}[Confirm]${NC}  [Cancel]"
        else
            echo -e "[Confirm]  ${RED}[Cancel]${NC}"
        fi
        echo ""
        
        # Read key
        IFS= read -rs -n1 key
        
        case "$key" in
            $'\x1b')  # Escape sequence (arrow keys)
                read -rs -n2 key
                case "$key" in
                    '[A')  # Up
                        if [ "$current" -gt 0 ]; then
                            ((current--))
                            confirm_selected=false
                        fi
                        ;;
                    '[B')  # Down
                        if [ "$current" -lt $((total-1)) ]; then
                            ((current++))
                            confirm_selected=false
                        fi
                        ;;
                    '[C')  # Right
                        if [ "$current" -lt $((total-mid)) ] && [ $((current+mid)) -lt "$total" ]; then
                            current=$((current+mid))
                            confirm_selected=false
                        fi
                        ;;
                    '[D')  # Left
                        if [ "$current" -ge "$mid" ]; then
                            current=$((current-mid))
                            confirm_selected=false
                        fi
                        ;;
                esac
                ;;
            ' ')  # Space - toggle
                selected[$current]=$((1 - ${selected[$current]}))
                ;;
            '')  # Enter - confirm or check position
                if [ "$current" -lt "$total" ]; then
                    # In the list, confirm selection
                    break
                fi
                ;;
            'q'|'Q')  # Quit
                tput cnorm 2>/dev/null || true
                exit 0
                ;;
        esac
    done
    
    # Show cursor
    tput cnorm 2>/dev/null || true
    
    # Build skip list
    SKIP_LIST=()
    for ((i=0; i<total; i++)); do
        if [ "${selected[$i]}" -eq 1 ]; then
            local tool="${TOOLS[$i]}"
            local name="${tool%%|*}"
            SKIP_LIST+=("$name")
        fi
    done
    
    echo ""
}

# ============================================
# CHECK FUNCTIONS
# ============================================

should_skip() {
    local display_name="$1"
    for skip_item in "${SKIP_LIST[@]}"; do
        if [ "$skip_item" = "$display_name" ]; then
            return 0
        fi
    done
    return 1
}

get_tool_info() {
    local display_name="$1"
    for tool in "${TOOLS[@]}"; do
        if [[ "$tool" == "$display_name"* ]]; then
            echo "$tool"
            return 0
        fi
    done
    return 1
}

check_tool() {
    local display_name="$1"
    local command_name="$2"
    local version_flag="$3"
    
    ((TOTAL_CHECKS++))
    
    printf "[%2d/%2d] Checking %s... " "$TOTAL_CHECKS" "${#TOOLS[@]}" "$display_name"
    
    # Check if should skip
    if should_skip "$display_name"; then
        print_warning "Skipped"
        ((SKIPPED++))
        return 0
    fi
    
    # Special handling for xclip on macOS
    if [ "$display_name" = "xclip" ] && [ "$OS" = "macos" ]; then
        print_warning "N/A (macOS uses pbcopy)"
        ((SKIPPED++))
        return 0
    fi
    
    # Special handling for NVM (not a regular command)
    if [ "$display_name" = "NVM" ]; then
        if [ -s "$HOME/.nvm/nvm.sh" ]; then
            local version
            version=$(. "$HOME/.nvm/nvm.sh" && nvm --version 2>/dev/null || echo "unknown")
            print_success "Found (v$version)"
            ((PASSED++))
            return 0
        else
            print_error "Missing"
            return 1
        fi
    fi
    
    # Special handling for GVM
    if [ "$display_name" = "GVM" ]; then
        if [ -s "$HOME/.gvm/scripts/gvm" ]; then
            print_success "Found"
            ((PASSED++))
            return 0
        else
            print_error "Missing"
            return 1
        fi
    fi
    
    # Check if command exists
    if ! command -v "$command_name" >/dev/null 2>&1; then
        print_error "Missing"
        return 1
    fi
    
    # Get version
    local version
    version=$($command_name $version_flag 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1 || echo "unknown")
    
    # Special handling for Neovim version
    if [ "$display_name" = "Neovim" ]; then
        if [ "$version" != "0.11.2" ]; then
            print_warning "Wrong version (v$version, required: v0.11.2)"
            return 1
        fi
    fi
    
    print_success "Found (v$version)"
    ((PASSED++))
    return 0
}

# ============================================
# INSTALLATION FUNCTIONS
# ============================================

confirm_install() {
    local tool="$1"
    
    if [ "$AUTO_CONFIRM" = true ]; then
        return 0
    fi
    
    read -rp "        Install $tool? (Y/n): " response
    if [[ "$response" =~ ^[Nn]$ ]]; then
        return 1
    fi
    return 0
}

install_tool() {
    local display_name="$1"
    local install_cmd="$2"
    
    if ! confirm_install "$display_name"; then
        print_error "Installation cancelled by user"
        exit 1
    fi
    
    echo -e "        ${BLUE}[INFO]${NC} Installing: $install_cmd"
    
    if eval "$install_cmd" 2>&1; then
        print_success "        Installed successfully"
        ((PASSED++))
        return 0
    else
        print_error "        Installation failed!"
        echo ""
        echo -e "${RED}Error:${NC} $install_cmd failed"
        echo ""
        echo "Please fix the error and re-run the script."
        echo "Exit code: 1"
        exit 1
    fi
}

get_install_command() {
    local display_name="$1"
    
    case "$display_name" in
        "Git")
            case "$OS" in
                macos) echo "brew install git" ;;
                arch) echo "yay -S --noconfirm git" ;;
                debian) echo "sudo apt install -y git" ;;
            esac
            ;;
        "GNU Stow")
            case "$OS" in
                macos) echo "brew install stow" ;;
                arch) echo "yay -S --noconfirm stow" ;;
                debian) echo "sudo apt install -y stow" ;;
            esac
            ;;
        "Zsh")
            case "$OS" in
                macos) echo "brew install zsh" ;;
                arch) echo "yay -S --noconfirm zsh" ;;
                debian) echo "sudo apt install -y zsh" ;;
            esac
            ;;
        "Starship")
            case "$OS" in
                macos) echo "brew install starship" ;;
                arch) echo "yay -S --noconfirm starship" ;;
                debian) echo "sudo apt install -y starship" ;;
            esac
            ;;
        "Tmux")
            case "$OS" in
                macos) echo "brew install tmux" ;;
                arch) echo "yay -S --noconfirm tmux" ;;
                debian) echo "sudo apt install -y tmux" ;;
            esac
            ;;
        "FZF")
            case "$OS" in
                macos) echo "brew install fzf" ;;
                arch) echo "yay -S --noconfirm fzf" ;;
                debian) echo "sudo apt install -y fzf" ;;
            esac
            ;;
        "Ripgrep")
            case "$OS" in
                macos) echo "brew install ripgrep" ;;
                arch) echo "yay -S --noconfirm ripgrep" ;;
                debian) echo "sudo apt install -y ripgrep" ;;
            esac
            ;;
        "fd")
            case "$OS" in
                macos) echo "brew install fd" ;;
                arch) echo "yay -S --noconfirm fd" ;;
                debian) echo "sudo apt install -y fd-find" ;;
            esac
            ;;
        "Cargo")
            case "$OS" in
                macos) echo "brew install rust" ;;
                arch) echo "yay -S --noconfirm rust" ;;
                debian) echo "sudo apt install -y cargo" ;;
            esac
            ;;
        "Bob")
            echo "cargo install bob-nvim"
            ;;
        "UV"|"UVX")
            echo "curl -LsSf https://astral.sh/uv/install.sh | sh"
            ;;
        "Neovim")
            echo "bob install 0.11.2 && bob use 0.11.2"
            ;;
        "Tree-sitter")
            case "$OS" in
                macos) echo "brew install tree-sitter" ;;
                arch) echo "yay -S --noconfirm tree-sitter" ;;
                debian) echo "sudo apt install -y tree-sitter-cli" ;;
            esac
            ;;
        "Lua")
            case "$OS" in
                macos) echo "brew install lua" ;;
                arch) echo "yay -S --noconfirm lua" ;;
                debian) echo "sudo apt install -y lua5.4" ;;
            esac
            ;;
        "Luarocks")
            case "$OS" in
                macos) echo "brew install luarocks" ;;
                arch) echo "yay -S --noconfirm luarocks" ;;
                debian) echo "sudo apt install -y luarocks" ;;
            esac
            ;;
        "Stylua")
            case "$OS" in
                macos) echo "brew install stylua" ;;
                arch) echo "yay -S --noconfirm stylua" ;;
                debian) echo "cargo install stylua" ;;
            esac
            ;;
        "CMake")
            case "$OS" in
                macos) echo "brew install cmake" ;;
                arch) echo "yay -S --noconfirm cmake" ;;
                debian) echo "sudo apt install -y cmake" ;;
            esac
            ;;
        "NVM")
            echo "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
            ;;
        "GVM")
            echo "bash < <(curl -s -S -L https://raw.githubusercontent.com/moovweb/gvm/master/binscripts/gvm-installer)"
            ;;
        "Lazygit")
            case "$OS" in
                macos) echo "brew install lazygit" ;;
                arch) echo "yay -S --noconfirm lazygit" ;;
                debian) echo "sudo apt install -y lazygit" ;;
            esac
            ;;
        "Lazydocker")
            case "$OS" in
                macos) echo "brew install lazydocker" ;;
                arch) echo "yay -S --noconfirm lazydocker" ;;
                debian) echo "curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash" ;;
            esac
            ;;
        "Colima")
            case "$OS" in
                macos) echo "brew install colima" ;;
                arch) echo "yay -S --noconfirm colima" ;;
                debian) echo "sudo apt install -y colima" ;;
            esac
            ;;
        "OpenCode")
            echo "curl -fsSL https://opencode.ai/install | sh"
            ;;
        "Tectonic")
            case "$OS" in
                macos) echo "brew install tectonic" ;;
                arch) echo "yay -S --noconfirm tectonic" ;;
                debian) echo "curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh" ;;
            esac
            ;;
        "Mermaid CLI")
            echo "npm install -g @mermaid-js/mermaid-cli"
            ;;
        "ImageMagick")
            case "$OS" in
                macos) echo "brew install imagemagick" ;;
                arch) echo "yay -S --noconfirm imagemagick" ;;
                debian) echo "sudo apt install -y imagemagick" ;;
            esac
            ;;
        "xclip")
            case "$OS" in
                arch) echo "yay -S --noconfirm xclip" ;;
                debian) echo "sudo apt install -y xclip" ;;
            esac
            ;;
        *)
            echo ""
            ;;
    esac
}

# ============================================
# STEP FUNCTIONS
# ============================================

run_check() {
    local display_name="$1"
    local tool_info
    tool_info=$(get_tool_info "$display_name")
    
    if [ -z "$tool_info" ]; then
        print_error "Unknown tool: $display_name"
        return 1
    fi
    
    local command_name="${tool_info#*|}"
    command_name="${command_name%%|*}"
    local version_flag="${tool_info##*|}"
    
    if ! check_tool "$display_name" "$command_name" "$version_flag"; then
        local install_cmd
        install_cmd=$(get_install_command "$display_name")
        if [ -n "$install_cmd" ]; then
            install_tool "$display_name" "$install_cmd"
        else
            print_error "No installation command available for $display_name"
            exit 1
        fi
    fi
}

step_core_tools() {
    print_step "Step 1/6: Core Tools"
    
    run_check "Git"
    run_check "GNU Stow"
    run_check "Zsh"
    
    echo ""
}

step_terminal_shell() {
    print_step "Step 2/6: Terminal & Shell"
    
    run_check "Starship"
    run_check "Tmux"
    run_check "FZF"
    run_check "Ripgrep"
    run_check "fd"
    
    echo ""
}

step_development_tools() {
    print_step "Step 3/6: Development Tools"
    
    run_check "Cargo"
    run_check "Bob"
    run_check "UV"
    run_check "UVX"
    run_check "Neovim"
    run_check "Tree-sitter"
    run_check "Lua"
    run_check "Luarocks"
    run_check "Stylua"
    run_check "CMake"
    
    echo ""
}

step_version_managers() {
    print_step "Step 4/6: Version Managers"
    
    run_check "NVM"
    run_check "GVM"
    
    echo ""
}

step_git_docker_tools() {
    print_step "Step 5/6: Git & Docker Tools"
    
    run_check "Lazygit"
    run_check "Lazydocker"
    run_check "Colima"
    
    echo ""
}

step_additional_tools() {
    print_step "Step 6/6: Additional Tools"
    
    run_check "OpenCode"
    run_check "Tectonic"
    run_check "Mermaid CLI"
    run_check "ImageMagick"
    
    if [ "$OS" != "macos" ]; then
        run_check "xclip"
    fi
    
    echo ""
}

# ============================================
# SUMMARY
# ============================================

print_summary() {
    print_header "Installation Complete!"
    
    if [ $FAILED -eq 0 ]; then
        print_success "All prerequisites installed successfully!"
    else
        print_error "Some prerequisites could not be installed"
    fi
    
    echo ""
    print_info "Summary:"
    echo -e "  ${GREEN}[OK]${NC} Passed: $PASSED"
    echo -e "  ${YELLOW}[WARN]${NC} Skipped: $SKIPPED"

    if [ $FAILED -gt 0 ]; then
        echo -e "  ${RED}[FAIL]${NC} Failed: $FAILED"
    fi
    
    echo ""
    print_warning "Manual steps required:"
    echo "  Install Kode Mono Font manually:"
    echo -e "    ${CYAN}https://fonts.google.com/specimen/Kode+Mono${NC}"
    
    echo ""
    print_info "Next steps:"
    echo "  1. Run dotfiles setup:"
    echo -e "     ${CYAN}stow */${NC}"
    echo ""
    echo "  2. Setup Tmux plugins:"
    echo -e "     ${CYAN}./tmux/check-plugins.sh${NC}"
    
    echo ""
    echo -e "${BOLD}========================================${NC}"
}

# ============================================
# HELP
# ============================================

show_help() {
    echo "Dotfiles Prerequisites Checker"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -y, --yes    Auto-confirm all installations (no prompts)"
    echo "  -h, --help   Show this help message"
    echo ""
    echo "This script checks and installs all prerequisites for the dotfiles."
    echo "It supports macOS, Arch Linux, and Debian/Ubuntu."
    echo ""
    echo "Examples:"
    echo "  $0           # Run with interactive prompts"
    echo "  $0 --yes     # Auto-confirm all installations"
}

# ============================================
# MAIN
# ============================================

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -y|--yes)
                AUTO_CONFIRM=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Header
    print_header "Dotfiles Prerequisites Checker"
    
    # Detect OS
    detect_os
    
    # Validate sudo
    validate_sudo
    
    # Install yay if needed (Arch)
    install_yay_if_needed
    
    # Ask about skipping tools
    if [ "$AUTO_CONFIRM" = false ]; then
        echo ""
        read -rp "Do you want to skip any tools? (y/N): " skip_prompt
        if [[ "$skip_prompt" =~ ^[Yy]$ ]]; then
            show_toggle_menu
            echo ""
        fi
    fi
    
    # Run all steps
    step_core_tools
    step_terminal_shell
    step_development_tools
    step_version_managers
    step_git_docker_tools
    step_additional_tools
    
    # Print summary
    print_summary
}

# Run main
main "$@"