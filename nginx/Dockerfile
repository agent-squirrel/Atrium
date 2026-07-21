FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html/admin
# Templated (not a plain conf) so TRUSTED_PROXY_CIDR can vary per deployment
# without an image rebuild - the official image's entrypoint runs envsubst
# on every *.template file here at container start.
COPY nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV TRUSTED_PROXY_CIDR=127.0.0.1
