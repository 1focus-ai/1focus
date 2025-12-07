#!/bin/bash
set -e

echo "=== R2 Setup ==="
echo ""
echo "1. Go to: https://dash.cloudflare.com"
echo "2. Select your account → R2 Object Storage"
echo "3. Create a bucket (if needed)"
echo "4. Go to 'Manage R2 API Tokens' → Create API Token"
echo "   - Permissions: Object Read & Write"
echo "   - Specify bucket: select your bucket"
echo ""

read -p "R2 Account ID (from URL: dash.cloudflare.com/<ACCOUNT_ID>/r2): " account_id
read -p "R2 Access Key ID: " access_key
read -p "R2 Secret Access Key: " -s secret_key
echo ""
read -p "R2 Bucket Name: " bucket
read -p "R2 Public URL (optional, press enter to skip): " public_url

r2_url="r2://${access_key}:${secret_key}@${account_id}/${bucket}"
if [ -n "$public_url" ]; then
  r2_url="${r2_url}?publicUrl=${public_url}"
fi

echo "R2_URL=${r2_url}" > .env

echo ""
echo "✓ Created .env"
echo ""
echo "Run 'flow run' to test the connection"
