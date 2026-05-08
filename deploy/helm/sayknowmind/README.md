# SayKnowMind Helm Chart

Helm chart for deploying SayKnowMind on Kubernetes. Mirrors the topology
defined in `docker-compose.yml` at the repo root.

## What this chart deploys

| Component       | Type           | External | Notes                              |
|-----------------|----------------|----------|------------------------------------|
| `web`           | Deployment     | yes (Ingress) | Next.js app (port 3000)        |
| `dashboard`     | Deployment     | yes (Ingress) | RAG dashboard (port 3000)      |
| `ai-server`     | Deployment+PVC | yes (Ingress) | NestJS routing/inference (4000)|
| `mcp-server`    | Deployment     | yes (Ingress) | Model Context Protocol (8082)  |
| `relay-server`  | Deployment     | yes (Ingress) | Encrypted relay sync (3200)    |
| `edgequake`     | Deployment     | no       | RAG engine (8080)                  |
| `ocr-server`    | Deployment     | no       | OCR service (8000)                 |
| `searxng`       | Deployment     | no       | Web search (8888)                  |
| `postgres`      | StatefulSet    | no       | Postgres 16 + pgvector + AGE       |
| `redis`         | Deployment     | no       | Cache / queue                      |
| `ollama`        | StatefulSet    | no       | Optional, off by default           |
| `ipfs`          | StatefulSet    | no       | Optional, off by default           |

## Prerequisites

1. **Kubernetes 1.27+** with a default StorageClass that supports `ReadWriteOnce`.
2. **nginx-ingress** controller installed (or change `ingress.className` in `values.yaml`).
3. **cert-manager** with a `ClusterIssuer` named `letsencrypt-prod` (or change `ingress.tls.issuer`).
4. **Container registry access**. Default registry is `ghcr.io/sayknowmind/sayknowmind`. If your registry is private, supply `imagePullSecrets`.
5. **Custom Postgres image** built from `docker/Dockerfile.postgres` (includes pgvector + Apache AGE) pushed to your registry. The stock `postgres:16-alpine` does **not** work — init scripts call `CREATE EXTENSION pgvector` and `CREATE EXTENSION age`.

## Build & push images

The chart references images at:

```
ghcr.io/sayknowmind/sayknowmind-<component>:<tag>
```

Components: `web`, `dashboard`, `ai-server`, `ocr-server`, `mcp-server`, `relay-server`, `edgequake`, `postgres`.

Example build script (run from repo root):

```sh
TAG=v0.1.0
REG=ghcr.io/sayknowmind/sayknowmind

docker build -t $REG-web:$TAG          apps/web
docker build -t $REG-dashboard:$TAG    apps/dashboard
docker build -t $REG-ai-server:$TAG    apps/ai-server
docker build -t $REG-ocr-server:$TAG   apps/ai-server/ocr-server -f apps/ai-server/ocr-server/Dockerfile.ocr
docker build -t $REG-mcp-server:$TAG   packages/mcp-server
docker build -t $REG-relay-server:$TAG packages/relay-server
docker build -t $REG-edgequake:$TAG    packages/edgequake -f packages/edgequake/docker/Dockerfile
docker build -t $REG-postgres:$TAG     docker -f docker/Dockerfile.postgres

for c in web dashboard ai-server ocr-server mcp-server relay-server edgequake postgres; do
  docker push $REG-$c:$TAG
done
```

## Install

1. **Copy the secret template and fill in real values:**

   ```sh
   cd deploy/helm/sayknowmind
   cp values-secret.example.yaml values-secret.yaml
   # Generate strong values
   openssl rand -base64 32                      # → betterAuthSecret
   openssl rand -hex 32                         # → encryptionKey, searxngSecretKey, relaySharedSecret, telegramWebhookSecret
   # Edit values-secret.yaml with the generated values + your API keys
   ```

   `values-secret.yaml` is in `.helmignore` and should be in your `.gitignore`.
   For production we recommend using **External Secrets Operator** or **Sealed Secrets** instead of a plaintext file.

2. **Set your domains:**

   Edit `values-production.yaml` (or pass via `--set`):
   ```yaml
   ingress:
     hosts:
       web: app.yourdomain.com
       dashboard: dashboard.yourdomain.com
       ai: ai.yourdomain.com
       mcp: mcp.yourdomain.com
       relay: relay.yourdomain.com
   ```

3. **Set the image tag** to a pinned release:
   ```yaml
   global:
     imageTag: v0.1.0
   ```

4. **Install:**
   ```sh
   kubectl create namespace sayknowmind
   helm install sayknowmind . \
     -n sayknowmind \
     -f values-production.yaml \
     -f values-secret.yaml
   ```

5. **Watch rollout:**
   ```sh
   kubectl get pods -n sayknowmind -w
   ```

## Upgrades

```sh
helm upgrade sayknowmind . \
  -n sayknowmind \
  -f values-production.yaml \
  -f values-secret.yaml \
  --set global.imageTag=v0.1.1
```

The chart annotates pods with hashes of `configmap-app.yaml` and `secret.yaml`,
so changing config or secret values triggers a rolling restart automatically.

## DB init scripts

Postgres `docker-entrypoint.sh` runs every `*.sql` and `*.sh` in `/docker-entrypoint-initdb.d/` in alphabetical order, **only on first DB initialization** (when `PGDATA` is empty).

These scripts are mirrored from `/db/init/` into `deploy/helm/sayknowmind/db-init/` so the chart is self-contained. Whenever the source files change, re-sync:

```sh
make helm-sync-db-init
```

If you need to re-run init on an existing DB, you must drop the PVC:
```sh
kubectl delete statefulset sayknowmind-postgres -n sayknowmind
kubectl delete pvc data-sayknowmind-postgres-0 -n sayknowmind
helm upgrade sayknowmind . -n sayknowmind ...   # recreates with empty volume
```

## Layout

```
deploy/helm/sayknowmind/
├── Chart.yaml
├── values.yaml                       # defaults
├── values-staging.yaml               # staging overrides
├── values-production.yaml            # prod overrides
├── values-secret.example.yaml        # template (copy → values-secret.yaml)
├── db-init/                          # mirror of repo /db/init/
├── files/searxng-settings.yml        # mirror of repo docker/searxng/settings.yml
└── templates/
    ├── _helpers.tpl
    ├── serviceaccount.yaml
    ├── secret.yaml
    ├── configmap-app.yaml            # non-secret env shared across services
    ├── configmap-db-init.yaml        # SQL files for postgres
    ├── postgres.yaml                 # StatefulSet + headless Service
    ├── redis.yaml
    ├── ollama.yaml                   # gated by ollama.enabled
    ├── ipfs.yaml                     # gated by ipfs.enabled
    ├── searxng.yaml
    ├── edgequake.yaml
    ├── ai-server.yaml                # Deployment + PVC for model cache
    ├── ocr-server.yaml
    ├── web.yaml
    ├── dashboard.yaml
    ├── mcp-server.yaml
    ├── relay-server.yaml
    ├── ingress.yaml
    └── NOTES.txt
```

## Validation

Render templates locally to inspect:
```sh
helm template sayknowmind . \
  -f values-production.yaml \
  -f values-secret.yaml > /tmp/rendered.yaml

helm lint .                  # syntax / convention check
kubeconform /tmp/rendered.yaml   # API schema check (optional but recommended)
```

## Known constraints

- `ai-server` uses a `ReadWriteOnce` PVC for the model cache, so it cannot scale beyond 1 replica unless you swap the volume for an `ReadWriteMany` (NFS / EFS / CephFS) class or remove the PVC and re-download models on each pod start.
- `postgres` is a single-replica StatefulSet. For HA Postgres, replace the bundled chart with an operator (Zalando, CrunchyData, CloudNativePG) and point services at it via the `DATABASE_URL` env var.
- `ollama` and `ipfs` are off by default. The `cloud` deployment mode uses external LLM APIs and does not need them.
- `web` and `dashboard` images bake `NEXT_PUBLIC_*` values at build time. If you change the public hostname in `values-production.yaml`, you must rebuild the web / dashboard images with matching `--build-arg NEXT_PUBLIC_APP_URL=...`.
