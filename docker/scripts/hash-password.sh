#!/bin/bash
# Generate BCrypt password hash for OpenSearch Security internal users
#
# Usage: ./hash-password.sh [password]
#
# If password is not provided, it will be read from stdin (useful for piping)
# The hash can be used in opensearch-security/internal_users.yml
#
# Example:
#   ./hash-password.sh mySecurePassword123
#   echo "myPassword" | ./hash-password.sh

set -euo pipefail

OPENSEARCH_IMAGE="${OPENSEARCH_IMAGE:-opensearchproject/opensearch:2.11.1}"

if [ $# -ge 1 ]; then
    PASSWORD="$1"
elif [ ! -t 0 ]; then
    # Read from stdin if piped
    read -r PASSWORD
else
    # Interactive prompt
    echo -n "Enter password to hash: " >&2
    read -rs PASSWORD
    echo >&2
fi

if [ -z "$PASSWORD" ]; then
    echo "Error: Password cannot be empty" >&2
    exit 1
fi

# Use OpenSearch's built-in hash.sh tool to generate BCrypt hash
docker run --rm -i "$OPENSEARCH_IMAGE" \
    /usr/share/opensearch/plugins/opensearch-security/tools/hash.sh \
    -p "$PASSWORD" 2>/dev/null | tail -1
