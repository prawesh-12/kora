#!/usr/bin/env bash
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_docker
check_port 5432
check_port 6379
compose up -d
bash "$ROOT/infra/scripts/wait-for-healthy.sh"
