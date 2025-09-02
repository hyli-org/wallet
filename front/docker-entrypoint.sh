#!/bin/sh

# Remplacer les variables d'environnement dans le bundle JavaScript
cd /usr/share/nginx/html

# Remplacer les variables dans le HTML
envsubst < index.html > index.html.tmp && mv index.html.tmp index.html

# Démarrer nginx
exec "$@"
