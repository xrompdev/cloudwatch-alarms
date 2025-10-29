#!/bin/bash
set -e

echo "Building triager Lambda package..."

# Clean previous builds
rm -rf dist/triager dist/triager.zip

# Create build directory
mkdir -p dist/triager

# Copy source files
cp triager/index.js dist/triager/
cp triager/package.json dist/triager/

# Install production dependencies
cd dist/triager
npm install --production --platform=linux --arch=arm64

# Create ZIP package
zip -r ../triager.zip . -x "*.git*" "*.DS_Store"

cd ../..

echo "✅ Triager Lambda package created: dist/triager.zip"
ls -lh dist/triager.zip
