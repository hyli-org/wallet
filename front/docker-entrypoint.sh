#!/bin/sh

# Replace environment variables in the JavaScript bundle
cd /usr/share/nginx/html

# Replace variables in the HTML
envsubst < index.html > index.html.tmp && mv index.html.tmp index.html

# Start nginx
exec "$@"
