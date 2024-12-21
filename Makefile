pull:
	docker-compose pull

up:
	docker-compose up -d

up-build:
	docker-compose up -d --build

down:
	docker-compose down

install:
	docker-compose exec app composer install

exec:
	docker exec -it video_intercom_http_server /bin/sh
