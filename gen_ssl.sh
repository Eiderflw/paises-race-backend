#!/bin/bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout /etc/ssl/private/apipais.key -out /etc/ssl/certs/apipais.crt -subj "/CN=apipais.samyflw.com"
echo "SSL_CREATED"
