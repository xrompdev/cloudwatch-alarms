#!/bin/bash
set -e

echo "Building all Lambda packages..."
echo "================================"

# Build triager
./scripts/build-triager.sh

echo ""
echo "================================"

# Build slack-interactions
./scripts/build-slack-interactions.sh

echo ""
echo "================================"
echo "✅ All Lambda packages built successfully!"
echo ""
echo "Next steps:"
echo "1. Copy terraform.tfvars.example to terraform.tfvars and fill in values"
echo "2. Run: cd ../terraform/envs/alarm-triager/staging"
echo "3. Run: terraform init"
echo "4. Run: terraform plan"
echo "5. Run: terraform apply"
