#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $EUID -eq 0 ]] || { printf 'Run on the Docker host as root.\n' >&2; exit 2; }
iptables -nL DOCKER-USER >/dev/null
container="$(docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml ps -q executor)"
[[ -n "$container" ]] || { printf 'Start the executor first.\n' >&2; exit 2; }
mapfile -t addresses < <(docker inspect --format '{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}' "$container" | sed '/^$/d')
[[ ${#addresses[@]} -gt 0 ]] || exit 2
for address in "${addresses[@]}"; do
    [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
done
# Change only the project-owned chain, never flush the host's firewall.
iptables -N APIFORGE_EXECUTOR 2>/dev/null || true
iptables -F APIFORGE_EXECUTOR
for address in "${addresses[@]}"; do
    iptables -A APIFORGE_EXECUTOR -s "$address" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    for resolver in 1.1.1.1 1.0.0.1; do
        iptables -A APIFORGE_EXECUTOR -s "$address" -d "$resolver" -p udp --dport 53 -j RETURN
        iptables -A APIFORGE_EXECUTOR -s "$address" -d "$resolver" -p tcp --dport 53 -j RETURN
    done
    for network in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
        iptables -A APIFORGE_EXECUTOR -s "$address" -d "$network" -j REJECT
    done
    iptables -A APIFORGE_EXECUTOR -s "$address" -p tcp --dport 443 -j RETURN
    iptables -A APIFORGE_EXECUTOR -s "$address" -j REJECT
done
iptables -A APIFORGE_EXECUTOR -j RETURN
iptables -C DOCKER-USER -j APIFORGE_EXECUTOR 2>/dev/null || iptables -I DOCKER-USER 1 -j APIFORGE_EXECUTOR
printf 'Executor IPv4 egress restricted to public HTTPS and configured DNS. Reapply after container recreation or host reboot.\nHostname approval and DNS pinning remain enforced by the application.\n'
