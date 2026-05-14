FROM ghcr.io/anomalyco/opencode:latest

RUN apk add --no-cache \
  bash \
  ca-certificates \
  coreutils \
  curl \
  git \
  jq \
  nodejs \
  npm \
  openssh-client \
  python3 \
  py3-pip \
  ripgrep \
  sed \
  tar \
  unzip \
  wget

RUN python3 -m venv /opt/shipsec-agent-venv \
  && /opt/shipsec-agent-venv/bin/pip install --no-cache-dir --upgrade pip

ENV PATH="/opt/shipsec-agent-venv/bin:${PATH}"
