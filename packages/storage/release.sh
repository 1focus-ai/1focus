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

# Calculate new version
IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
case $VERSION_TYPE in
  major) NEW_VERSION="$((major + 1)).0.0" ;;
  minor) NEW_VERSION="$major.$((minor + 1)).0" ;;
  patch) NEW_VERSION="$major.$minor.$((patch + 1))" ;;
  *) echo "Invalid version type: $VERSION_TYPE"; exit 1 ;;
esac

echo "New version: $NEW_VERSION"
echo ""

# Update package.json version using node
node -e "const pkg = require('./package.json'); pkg.version = '$NEW_VERSION'; require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n')"

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
