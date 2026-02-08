#!/usr/bin/env bash
# One-time setup for host PostgreSQL on inference-public
# Creates the beacon user and harmonic_beacon database
#
# Run as root (or with sudo) on the inference server:
#   bash deploy/setup-host-postgres.sh
#
# After running, set the DB_PASSWORD GitHub Secret to the generated password.

set -euo pipefail

DB_USER="beacon"
DB_NAME="harmonic_beacon"

# Generate password if not provided
if [ -z "${DB_PASSWORD:-}" ]; then
    DB_PASSWORD=$(openssl rand -base64 24)
    echo "Generated DB_PASSWORD: $DB_PASSWORD"
    echo "Save this as a GitHub Secret (DB_PASSWORD)"
fi

echo "Setting up PostgreSQL for Harmonic Beacon..."

# Create user if not exists
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    echo "User '${DB_USER}' already exists, updating password..."
    sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
else
    echo "Creating user '${DB_USER}'..."
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';"
fi

# Create database if not exists
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    echo "Database '${DB_NAME}' already exists"
else
    echo "Creating database '${DB_NAME}'..."
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# Allow connections from all Docker networks (default bridge + compose-created bridges)
# Docker uses 172.16.0.0/12 for bridge networks by default
PG_HBA=$(sudo -u postgres psql -tAc "SHOW hba_file")
DOCKER_RANGE="172.16.0.0/12"

if ! grep -q "${DB_NAME}.*${DOCKER_RANGE}" "$PG_HBA" 2>/dev/null; then
    # Remove any old per-subnet rules for this database
    sudo sed -i "/${DB_NAME}.*${DB_USER}.*172\./d" "$PG_HBA"
    echo "Adding Docker network access to pg_hba.conf (${DOCKER_RANGE})..."
    echo "host    ${DB_NAME}    ${DB_USER}    ${DOCKER_RANGE}    scram-sha-256" | sudo tee -a "$PG_HBA" > /dev/null
    echo "Reloading PostgreSQL..."
    sudo -u postgres psql -c "SELECT pg_reload_conf();"
else
    echo "pg_hba.conf already configured for ${DB_NAME} on Docker range"
fi

DOCKER_BRIDGE=$(ip -4 addr show docker0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}/\d+' || echo "")
if [ -n "$DOCKER_BRIDGE" ]; then

    # Ensure PostgreSQL listens on Docker bridge interface
    PG_CONF=$(sudo -u postgres psql -tAc "SHOW config_file")
    LISTEN=$(sudo -u postgres psql -tAc "SHOW listen_addresses")
    if echo "$LISTEN" | grep -qE '^\*$|docker0'; then
        echo "PostgreSQL already listening on all/docker interfaces"
    else
        echo ""
        echo "WARNING: PostgreSQL listen_addresses = '${LISTEN}'"
        echo "Docker containers need PG to listen on the Docker bridge interface."
        echo "Add to ${PG_CONF}:"
        echo "  listen_addresses = 'localhost,$(echo "$DOCKER_BRIDGE" | cut -d/ -f1)'"
        echo "Then restart PostgreSQL: sudo systemctl restart postgresql"
    fi
fi

# Create data directories
echo "Creating data directories..."
sudo mkdir -p /mnt/n8n-data/harmonic-beacon/meditations
sudo mkdir -p /mnt/n8n-data/harmonic-beacon/uploads
sudo chown -R 1001:1001 /mnt/n8n-data/harmonic-beacon/uploads

echo ""
echo "Setup complete!"
echo "DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?schema=public"
