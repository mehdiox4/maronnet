#!/bin/sh
# Lancement de MARONET 360 sur macOS / Linux.  Usage : ./start-mac-linux.sh [demo]
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Node.js n'est pas installé. Installez la version 22 LTS ou plus récente : https://nodejs.org"; exit 1; fi
MAJ=$(node -p "process.versions.node.split('.')[0]")
MIN=$(node -p "process.versions.node.split('.')[1]")
if [ "$MAJ" -lt 22 ] || { [ "$MAJ" -eq 22 ] && [ "$MIN" -lt 13 ]; }; then echo "Node.js 22.13 ou plus récent est requis (version actuelle : $(node -v))."; exit 1; fi
if [ "$1" = "demo" ]; then echo "Chargement des données de DÉMONSTRATION fictives…"; node server/demo.js; fi
echo "Démarrage de MARONET 360 — l'adresse s'affiche ci-dessous (par défaut http://localhost:3000)"
exec node server/index.js
