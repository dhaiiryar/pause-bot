# Homelab-first deploy, portable process

V1 runs on the operator's always-on machine (Docker or systemd). The app stays a single Node process with env-based config and a configurable SQLite path so moving to a VPS/PaaS later does not require a redesign.
