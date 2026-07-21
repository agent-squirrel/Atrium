#!/bin/sh
set -e

# Status markers for the frontend's "starting up" screen (see nginx.conf's
# /status/ location and App.tsx) - written as plain files so nginx can serve
# them statically before gunicorn is even listening.
mkdir -p /status
echo '{"message": "Setting up the database..."}' > /status/state.json

if [ ! -f migrations/env.py ]; then
    flask db init
    flask db migrate -m "initial schema"
fi

flask db upgrade

echo '{"message": "Starting the application server..."}' > /status/state.json
exec gunicorn -c gunicorn.conf.py wsgi:app
