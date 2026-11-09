FROM node:22-bookworm-slim AS browser-build
WORKDIR /opt/browser
COPY browser/package.json browser/package-lock.json ./
RUN npm ci --omit=dev
COPY browser/browser.js ./
RUN ./node_modules/.bin/esbuild browser.js --bundle --format=iife --platform=browser --target=es2020 --minify --outfile=otel-browser.js

FROM nginx@sha256:02892f7afb1ef49c55c869c5691010f2b8b5a571d291a52b33332ddefcb2ac0b
COPY nginx.conf /etc/nginx/nginx.conf
COPY default.conf /etc/nginx/conf.d/default.conf
COPY index.html app.js style.css /usr/share/nginx/html/
COPY --from=browser-build /opt/browser/otel-browser.js /usr/share/nginx/html/otel-browser.js
EXPOSE 80
