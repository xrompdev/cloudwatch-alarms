#!/bin/bash
set -e

echo "Building Slack interactions Lambda package..."

# Clean previous builds
rm -rf dist/slack-interactions dist/slack-interactions.zip

# Create build directory
mkdir -p dist/slack-interactions

# Copy source files
cp slack-interactions/index.js dist/slack-interactions/
cp slack-interactions/package.json dist/slack-interactions/

# Install production dependencies (minimal)
cd dist/slack-interactions
npm install --production --platform=linux --arch=arm64

# Create ZIP package
zip -r ../slack-interactions.zip . -x "*.git*" "*.DS_Store"

cd ../..

echo "✅ Slack interactions Lambda package created: dist/slack-interactions.zip"
ls -lh dist/slack-interactions.zip
