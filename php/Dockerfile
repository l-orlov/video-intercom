FROM php:8.2-apache

# Копируем проект в контейнер
COPY . /var/www/html

# Настраиваем права доступа
RUN chown -R www-data:www-data /var/www/html

# Включаем отображение ошибок PHP
RUN echo "display_errors = On" >> /usr/local/etc/php/conf.d/docker-php-error.ini
