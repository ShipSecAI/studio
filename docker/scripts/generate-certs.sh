#!/bin/bash
# Generate TLS certificates for OpenSearch production deployment
#
# This script creates:
#   - Root CA certificate and key
#   - Node certificate for OpenSearch (server)
#   - Admin certificate for cluster management
#
# Usage: ./generate-certs.sh [output-dir]
#
# Requirements: openssl

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${1:-$SCRIPT_DIR/../certs}"
DAYS_VALID=365

# Certificate Subject fields
COUNTRY="US"
STATE="CA"
LOCALITY="SF"
ORGANIZATION="ShipSecAI"
ORG_UNIT="ShipSec"

echo "=== OpenSearch Certificate Generator ==="
echo "Output directory: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR"

# Check if certificates already exist
if [[ -f "root-ca.pem" ]]; then
    echo "WARNING: Certificates already exist in $OUTPUT_DIR"
    read -p "Overwrite existing certificates? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

echo "1. Generating Root CA..."
openssl genrsa -out root-ca-key.pem 2048
openssl req -new -x509 -sha256 -key root-ca-key.pem -out root-ca.pem -days $DAYS_VALID \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORG_UNIT/CN=Root CA"

echo "2. Generating Admin Certificate..."
openssl genrsa -out admin-key-temp.pem 2048
openssl pkcs8 -inform PEM -outform PEM -in admin-key-temp.pem -topk8 -nocrypt -out admin-key.pem
openssl req -new -key admin-key.pem -out admin.csr \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORG_UNIT/CN=admin"
openssl x509 -req -in admin.csr -CA root-ca.pem -CAkey root-ca-key.pem -CAcreateserial \
    -sha256 -out admin.pem -days $DAYS_VALID
rm admin-key-temp.pem admin.csr

echo "3. Generating Node Certificate..."
# Create extension file for SAN (Subject Alternative Names)
cat > node-ext.cnf << EOF
subjectAltName = DNS:localhost, DNS:opensearch, DNS:opensearch-node1, IP:127.0.0.1
EOF

openssl genrsa -out node-key-temp.pem 2048
openssl pkcs8 -inform PEM -outform PEM -in node-key-temp.pem -topk8 -nocrypt -out node-key.pem
openssl req -new -key node-key.pem -out node.csr \
    -subj "/C=$COUNTRY/ST=$STATE/L=$LOCALITY/O=$ORGANIZATION/OU=$ORG_UNIT/CN=opensearch-node1"
openssl x509 -req -in node.csr -CA root-ca.pem -CAkey root-ca-key.pem -CAcreateserial \
    -sha256 -out node.pem -days $DAYS_VALID -extfile node-ext.cnf
rm node-key-temp.pem node.csr node-ext.cnf

echo "4. Setting permissions..."
chmod 600 *-key.pem
chmod 644 *.pem

echo ""
echo "=== Certificates Generated Successfully ==="
echo ""
echo "Files created in $OUTPUT_DIR:"
ls -la "$OUTPUT_DIR"
echo ""
echo "Next steps:"
echo "  1. Review the certificates"
echo "  2. Set OPENSEARCH_ADMIN_PASSWORD and OPENSEARCH_DASHBOARDS_PASSWORD environment variables"
echo "  3. Run: docker compose -f docker-compose.infra.yml -f docker-compose.prod.yml up -d"
echo ""
echo "For production deployments:"
echo "  - Use proper certificate authority (e.g., Let's Encrypt, internal CA)"
echo "  - Store private keys securely (e.g., HashiCorp Vault, AWS Secrets Manager)"
echo "  - Rotate certificates before expiration ($DAYS_VALID days)"
