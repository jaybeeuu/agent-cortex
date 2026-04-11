#!/usr/bin/env bash
# Installs gitleaks using the appropriate method for the current platform.
set -euo pipefail

if command -v gitleaks &>/dev/null; then
  echo "gitleaks is already installed: $(gitleaks version)"
  exit 0
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  if command -v brew &>/dev/null; then
    echo "Installing gitleaks via Homebrew..."
    brew install gitleaks
  else
    echo "Homebrew not found. Install it from https://brew.sh, then run: brew install gitleaks"
    exit 1
  fi
elif [ "$OS" = "Linux" ]; then
  if command -v apt-get &>/dev/null; then
    echo "Installing gitleaks via apt..."
    sudo apt-get install -y gitleaks
  else
    echo "Downloading latest gitleaks release from GitHub..."
    LATEST=$(curl -s https://api.github.com/repos/gitleaks/gitleaks/releases/latest \
      | grep '"tag_name"' | cut -d'"' -f4)
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64) ARCH="x64" ;;
      aarch64|arm64) ARCH="arm64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    URL="https://github.com/gitleaks/gitleaks/releases/download/${LATEST}/gitleaks_${LATEST#v}_linux_${ARCH}.tar.gz"
    curl -sL "$URL" | tar -xz -C /usr/local/bin gitleaks
    chmod +x /usr/local/bin/gitleaks
  fi
else
  echo "Unsupported OS: $OS. See https://github.com/gitleaks/gitleaks#installing for manual install instructions."
  exit 1
fi

echo "Installed: $(gitleaks version)"
