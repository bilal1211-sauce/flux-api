FROM composer:2 AS composer
FROM dunglas/frankenphp:1-php8.3-bookworm
RUN install-php-extensions pdo_mysql pdo_sqlite intl zip pcntl
COPY --from=composer /usr/bin/composer /usr/bin/composer
WORKDIR /app/apps/api
COPY apps/api/composer.json apps/api/composer.lock ./
RUN composer install --no-dev --no-scripts --prefer-dist --no-interaction
COPY apps/api ./
COPY apps/executor /app/apps/executor
RUN composer dump-autoload --optimize && php artisan package:discover && chown -R www-data:www-data storage bootstrap/cache
COPY infrastructure/Caddyfile /etc/caddy/Caddyfile
ENV SERVER_NAME=:8080 DOCUMENT_ROOT=/app/apps/api/public
EXPOSE 8080
