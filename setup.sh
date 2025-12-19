#!/bin/bash

# A script to automate the setup of the trmnl_chess development environment.

set -e # Exit immediately if a command exits with a non-zero status.

echo "### Starting trmnl_chess environment setup... ###"

# --- Helper Functions ---
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# --- Dependency Checks ---
echo "\n1. Checking for required tools..."
if ! command_exists ruby || ! command_exists gem; then
    echo "ERROR: Ruby and gem are required to run the trmnlp server. Please install Ruby 3.x and re-run this script."
    exit 1
fi
if ! command_exists node || ! command_exists npm; then
    echo "ERROR: Node.js and npm are required. Please install them and re-run this script."
    exit 1
fi
if ! command_exists python3; then
    echo "ERROR: Python 3 is required. Please install it and re-run this script."
    exit 1
fi
echo "✓ All required tools are installed."

# --- Install Ruby Gem ---
echo "\n2. Installing trmnl_preview Ruby gem..."
if gem list -i trmnl_preview >/dev/null 2>&1; then
    echo "✓ 'trmnl_preview' gem already installed."
else
    gem install trmnl_preview
fi
echo "✓ Ruby dependencies are installed."

# --- Install Node.js Dependencies ---
echo "\n3. Installing backend Node.js dependencies..."
if [ -d "website/backend/node_modules" ]; then
    echo "✓ 'node_modules' already exists. Skipping 'npm install'."
else
    (cd website/backend && npm install)
fi
echo "✓ Backend dependencies are installed."

# --- Final Manual Steps ---
echo "\n--------------------------------------------------"
echo "✓ Automated setup is complete!"

echo "\nNext, please perform these manual steps:"
echo "1. Set up a Redis instance (e.g., a free one from Upstash: https://upstash.com/)."
echo '2. Copy the sample env: cp website/backend/.env.example website/backend/.env'
echo '3. Fill in UPSTASH_REDIS_* and FRONTEND_URL in website/backend/.env'
echo ""
echo "After that, you will be ready to run the project."
echo "--------------------------------------------------"
