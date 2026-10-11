.DEFAULT_GOAL := help

.PHONY: help install setup first-start start dev check e2e build start-built admin-init seed backup-local first-deploy first-deploy-ota deploy start-server stop-server status logs backup server-admin-init server-seed ota-check ota-status ota-update typecheck test sdk-check boundaries

ADMIN_USER ?= admin

ifneq ($(wildcard ota-state/active.json),)
COMPOSE := docker compose -f compose.yaml -f compose.ota.yaml -f ota-state/active.json
else
COMPOSE := docker compose -f compose.yaml
endif

help:
	@echo "Local development (Node.js 24+):"
	@echo "make first-start Install dependencies, initialize local preview, then start development (stop platform first)"
	@echo "make setup      Install dependencies and initialize local admin/demo games (stop platform first)"
	@echo "make start      Start local development at http://localhost:5173 (dev is an alias)"
	@echo "make check      Run SDK, type, boundary, build and unit/integration checks"
	@echo "make e2e        Run Playwright browser tests"
	@echo "make build      Build frontend and backend"
	@echo "make start-built Start the built platform at http://localhost:3000"
	@echo "make admin-init Initialize a local admin after building; ADMIN_USER defaults to admin"
	@echo "make seed       Build and install/update local demo games (stop platform first)"
	@echo "make backup-local BACKUP=backups/name   Back up local data to a new directory"
	@echo "Docker server (configured .env, Compose v2 and writable backups directory):"
	@echo "make first-deploy Build, initialize admin and start ordinary Compose"
	@echo "make first-deploy-ota Fresh Linux OTA deployment via scripts/deploy-ota.sh"
	@echo "make start-server Start existing Docker services without rebuilding"
	@echo "make stop-server Stop Compose services, preserving data volumes (local dev: Ctrl+C)"
	@echo "make status / make logs  Inspect Docker services / latest 100 log lines"
	@echo "make backup BACKUP=name  Back up running app to a new /backups/name directory"
	@echo "make deploy BACKUP=name  Back up then build/deploy ordinary Compose from current checkout"
	@echo "make server-admin-init / make server-seed  Initialize admin / demos with server stopped"
	@echo "OTA updates (existing OTA deployment):"
	@echo "make ota-check / make ota-status  Check latest commit / inspect update jobs"
	@echo "make ota-update COMMIT=full-sha    Queue update through existing updater with backup/rollback"
	@echo "make deploy COMMIT=full-sha        Same as ota-update when OTA is detected"
	@echo "Other targets: install typecheck test sdk-check boundaries"

install:
	npm ci

setup: install
	node --env-file-if-exists=.env --import tsx scripts/preview-setup.ts

first-start: setup
	$(MAKE) start

start:
	npm run dev

dev: start

# Keep checks sequential, including when invoked with make -j.
check:
	npm run sdk:check
	npm run typecheck
	npm run check:boundaries
	npm run build
	npm test

e2e:
	npm run test:e2e

build:
	npm run build

start-built:
	npm start

admin-init: build
	npm run admin:init -- "$(ADMIN_USER)"

seed: build
	npm run demo:seed

backup-local:
ifeq ($(strip $(BACKUP)),)
	$(error Specify a new directory: make backup-local BACKUP=backups/pre-update-name)
endif
	npm run backup -- "$(BACKUP)"

first-deploy:
ifneq ($(wildcard ota-state/active.json),)
	$(error OTA already configured: use make start-server or make ota-update)
else
	$(COMPOSE) build
	$(MAKE) server-admin-init
	$(MAKE) start-server
endif

first-deploy-ota:
	bash scripts/deploy-ota.sh

deploy:
ifneq ($(wildcard ota-state/active.json),)
	$(MAKE) ota-update COMMIT="$(COMMIT)"
else
	$(MAKE) backup BACKUP="$(BACKUP)"
	$(COMPOSE) up -d --build --wait app
endif

start-server:
	$(COMPOSE) up -d --no-build --wait

stop-server:
	$(COMPOSE) stop

status:
	$(COMPOSE) ps -a

logs:
	$(COMPOSE) logs --tail=100

backup:
ifeq ($(strip $(BACKUP)),)
	$(error Specify a new backup name: make backup BACKUP=pre-update-name)
endif
	$(COMPOSE) exec -T app npm run backup -- "/backups/$(BACKUP)"

server-admin-init:
	$(COMPOSE) run --rm --no-deps app npm run admin:init -- "$(ADMIN_USER)"

server-seed:
	$(COMPOSE) run --rm --no-deps app npm run demo:seed

ota-check ota-status ota-update:
ifeq ($(wildcard ota-state/active.json),)
	$(error OTA not configured: see docs/platform-updates.md)
endif
	$(if $(filter ota-update,$@),$(if $(strip $(COMMIT)),,$(error Run make ota-check, then make ota-update COMMIT=full-40-character-sha)))
	$(COMPOSE) exec -T updater node --input-type=module - $(patsubst ota-%,%,$@) "$(COMMIT)" < scripts/ota-cli.mjs

typecheck:
	npm run typecheck

test:
	npm test

sdk-check:
	npm run sdk:check

boundaries:
	npm run check:boundaries
