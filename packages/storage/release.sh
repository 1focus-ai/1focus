#!/bin/bash
set -e

echo "=== Release @1focus/storage ==="
echo ""

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

# Get version bump type
VERSION_TYPE="${1:-patch}"
echo "Version bump: $VERSION_TYPE"
echo ""

# Bump version
npm version $VERSION_TYPE --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "New version: $NEW_VERSION"
echo ""

# Build
echo "Building..."
rm -rf dist
bun run build
echo ""

# Prompt for OTP
read -p "Enter npm OTP code: " otp

# Publish
echo "Publishing..."
npm publish --access public --otp="$otp"

echo ""
echo "Released @1focus/storage@$NEW_VERSION"
echo "Install with: bun add @1focus/storage"
