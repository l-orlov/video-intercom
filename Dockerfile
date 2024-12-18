# Use the official PHP image with Apache
FROM php:8.1-apache

# Install necessary PHP extensions and tools
RUN apt-get update && apt-get install -y \
    libzip-dev unzip git \
    && docker-php-ext-install pdo pdo_mysql \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Set the working directory
WORKDIR /var/www/html

# Copy application files to the container
COPY . /var/www/html/

# Install PHP dependencies using Composer
RUN composer install

# Set correct permissions for application files
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

# Expose necessary ports
EXPOSE 8888 8081