#!/bin/bash

# Bash Computer Use Agent - Simple Run Script for macOS
# Handles PEP 668 externally-managed-environment issue

echo "🚀 Starting Bash Computer Use Agent..."

# Check if dependencies are installed
if ! python3 -c "import openai" 2>/dev/null; then
    echo "📦 Installing dependencies..."
    echo "ℹ️  Using --break-system-packages to bypass PEP 668 protection"
    echo "   (This is safe and commonly used for development tools)"

    # First uninstall any problematic OpenAI versions
    python3 -m pip uninstall --break-system-packages -y openai 2>/dev/null

    # Install dependencies
    python3 -m pip install --break-system-packages -r requirements.txt
    if [ $? -eq 0 ]; then
        echo "✅ Dependencies installed successfully!"
    else
        echo "❌ Failed to install dependencies"
        echo "💡 Trying alternative installation method..."
        python3 -m pip install --break-system-packages "openai>=1.50.0,<1.52.0" "python-dotenv==1.0.1" "httpx[http2]>=0.28.0"
        if [ $? -eq 0 ]; then
            echo "✅ Alternative installation successful!"
        else
            echo "❌ All installation methods failed"
            echo "📚 Check TROUBLESHOOTING.md for manual fixes"
            exit 1
        fi
    fi
fi

# Run the agent
echo "🤖 Launching agent..."
python3 main.py