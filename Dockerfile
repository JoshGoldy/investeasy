FROM php:8.2-apache

# Install PHP extensions needed by InvestEasy
RUN docker-php-ext-install pdo pdo_mysql

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Download Azure MySQL SSL CA certificate (required for Azure MySQL Flexible Server)
RUN curl -o /usr/local/share/ca-certificates/DigiCertGlobalRootCA.crt.pem \
    https://dl.cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem && \
    update-ca-certificates

# Copy all project files into the web root
COPY . /var/www/html/

# Fix permissions
RUN chown -R www-data:www-data /var/www/html

# Azure App Service sets PORT env var — Apache listens on 80 by default, which matches
EXPOSE 80
