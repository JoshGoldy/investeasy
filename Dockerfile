FROM php:8.2-apache

# Install PHP extensions needed by InvestEasy
RUN docker-php-ext-install pdo pdo_mysql

# Enable Apache mod_rewrite (for clean URLs if needed)
RUN a2enmod rewrite

# Copy all project files into the web root
COPY . /var/www/html/

# Fix permissions
RUN chown -R www-data:www-data /var/www/html
