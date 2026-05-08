# SayKnowMind Helm Chart 部署指南

本 Chart 用于在 Kubernetes 集群上部署 SayKnowMind（agentic second brain），
拓扑结构与代码仓库根目录的 `docker-compose.yml` 一致。

> 英文版文档见 [`README.md`](./README.md)。

---

## 1. 部署组件总览

| 组件             | 类型             | 对外暴露 | 说明                                    |
|------------------|------------------|----------|-----------------------------------------|
| `web`            | Deployment       | 是（Ingress） | Next.js 主应用，端口 3000           |
| `dashboard`      | Deployment       | 是（Ingress） | RAG 仪表盘，端口 3000               |
| `ai-server`      | Deployment + PVC | 是（Ingress） | NestJS 推理路由服务，端口 4000      |
| `mcp-server`     | Deployment       | 是（Ingress） | Model Context Protocol，端口 8082   |
| `relay-server`   | Deployment       | 是（Ingress） | 加密同步中继服务，端口 3200         |
| `edgequake`      | Deployment       | 否       | RAG 引擎（Rust），端口 8080             |
| `ocr-server`     | Deployment       | 否       | OCR 服务，端口 8000                     |
| `searxng`        | Deployment       | 否       | 元搜索引擎，端口 8888                   |
| `postgres`       | StatefulSet      | 否       | PostgreSQL 16 + pgvector + Apache AGE   |
| `redis`          | Deployment       | 否       | 缓存与队列                              |
| `ollama`         | StatefulSet      | 否       | 可选；默认禁用（云端部署使用外部 LLM API）|
| `ipfs`           | StatefulSet      | 否       | 可选；默认禁用（仅共享/去中心化模式需要）|

部署完成后会创建 **27 个 K8s 资源**（已通过 `helm template` 渲染验证）：
- 1 × Ingress
- 1 × Secret
- 3 × ConfigMap
- 9 × Deployment
- 1 × StatefulSet（postgres）
- 10 × Service
- 1 × PVC（ai-server 模型缓存）
- 1 × ServiceAccount

---

## 2. 前置条件

### 2.1 集群侧
1. **Kubernetes 1.27+**，并配置默认 StorageClass，支持 `ReadWriteOnce`
2. **nginx-ingress** 控制器已安装（如使用其他控制器，修改 `values.yaml` 中的 `ingress.className`）
3. **cert-manager** 已安装，并已创建名为 `letsencrypt-prod` 的 ClusterIssuer
   （或修改 `ingress.tls.issuer` 为你已有的 Issuer 名称）
4. 如使用私有镜像仓库，需配置 `imagePullSecrets`

### 2.2 镜像侧（重要）

#### 必须自行构建并推送的镜像（共 8 个）
Chart 默认引用以下镜像，命名规则为：
```
ghcr.io/sayknowmind/sayknowmind-<组件名>:<tag>
```

| 组件名         | Dockerfile 路径                                          |
|----------------|----------------------------------------------------------|
| web            | `apps/web/Dockerfile`                                    |
| dashboard      | `apps/dashboard/Dockerfile`                              |
| ai-server      | `apps/ai-server/Dockerfile`                              |
| ocr-server     | `apps/ai-server/ocr-server/Dockerfile.ocr`               |
| mcp-server     | `packages/mcp-server/Dockerfile`                         |
| relay-server   | `packages/relay-server/Dockerfile`                       |
| edgequake      | `packages/edgequake/docker/Dockerfile`                   |
| **postgres**   | `docker/Dockerfile.postgres`（**必须自行构建，原因见下**）|

#### ⚠️ 关键提示：PostgreSQL 镜像

**不能使用官方 `postgres:16-alpine` 镜像。**

SayKnowMind 的初始化 SQL 脚本依赖两个扩展：
- `pgvector`（向量检索）
- `Apache AGE`（图数据库）

`docker/Dockerfile.postgres` 在 `postgres:16-bookworm` 基础上编译并安装了上述扩展。
若直接使用官方镜像，`CREATE EXTENSION pgvector` / `CREATE EXTENSION age` 会执行失败，
导致 Pod 进入 `CrashLoopBackOff`。

#### 第三方镜像（直接拉取，无需自建）
- `redis:7-alpine`
- `searxng/searxng:latest`
- `ollama/ollama:latest`（如启用 ollama）
- `ipfs/kubo:latest`（如启用 ipfs）

#### 镜像构建脚本（在仓库根目录执行）
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

> 如希望切换到自有的镜像仓库，修改 `values.yaml` 中的 `global.registry` 和 `global.imagePrefix` 即可。

---

## 3. NEXT_PUBLIC_* 构建期注入（重要）

`web` 和 `dashboard` 镜像使用 Next.js 框架，浏览器可见的环境变量（前缀 `NEXT_PUBLIC_*`）
**在镜像构建时被静态注入**，运行时无法修改。

这意味着如果你修改了对外域名（如 `app.sayknowmind.com` → `app.example.cn`），
**必须重新构建镜像**，并通过 `--build-arg` 传入新域名：

```sh
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://app.example.cn \
  --build-arg NEXT_PUBLIC_DEPLOY_MODE=cloud \
  --build-arg BETTER_AUTH_URL=https://app.example.cn \
  -t $REG-web:$TAG \
  apps/web
```

不同环境（staging / production）通常需要构建不同的镜像。

---

## 4. 准备 Secret 配置文件

```sh
cd deploy/helm/sayknowmind
cp values-secret.example.yaml values-secret.yaml
```

随后编辑 `values-secret.yaml`，填入以下 11 个密钥（前 5 个为必填，其余可选）：

| 字段                   | 必填 | 生成方式                            | 用途                              |
|------------------------|------|-------------------------------------|-----------------------------------|
| `postgresPassword`     | ✅   | 自行设置强密码                      | PostgreSQL 超级用户密码           |
| `betterAuthSecret`     | ✅   | `openssl rand -base64 32`           | Better-auth 会话签名密钥          |
| `encryptionKey`        | ✅   | `openssl rand -hex 32`              | AES-256-GCM 用户数据加密密钥      |
| `relaySharedSecret`    | ✅   | `openssl rand -hex 32`              | Relay 服务共享密钥                |
| `searxngSecretKey`     | ✅   | `openssl rand -hex 32`              | SearXNG 会话密钥                  |
| `aiApiKey`             | 可选 | 自行设置                            | AI Server 客户端调用鉴权          |
| `edgequakeApiKey`      | 可选 | 自行设置                            | EdgeQuake 客户端调用鉴权          |
| `openaiApiKey`         | 可选 | OpenAI 控制台获取                   | 使用 OpenAI 模型时填写            |
| `openrouterApiKey`     | 可选 | OpenRouter 控制台获取               | 使用 OpenRouter 时填写            |
| `telegramBotToken`     | 可选 | BotFather 获取                      | 启用 Telegram 集成时填写          |
| `telegramWebhookSecret`| 可选 | `openssl rand -hex 32`              | 启用 Telegram 集成时填写          |

> ⚠️ **`values-secret.yaml` 已加入 `.gitignore` 和 `.helmignore`，不会被提交到代码仓库或打包进 Chart。**

#### 生产环境建议

强烈建议使用以下任一方案，避免在文件中明文存储密钥：
- **External Secrets Operator** + Vault / AWS Secrets Manager / GCP Secret Manager
- **Sealed Secrets**（Bitnami）
- **SOPS** + age/PGP 加密

---

## 5. 配置域名

编辑 `values-production.yaml`，填入实际域名：

```yaml
ingress:
  hosts:
    web:       app.sayknowmind.com         # 主站
    dashboard: dashboard.sayknowmind.com   # RAG 仪表盘
    ai:        ai.sayknowmind.com          # AI Server
    mcp:       mcp.sayknowmind.com         # MCP 服务
    relay:     relay.sayknowmind.com       # Relay 同步服务
  tls:
    enabled: true
    issuer:  letsencrypt-prod
```

并锁定镜像标签（生产环境切勿使用 `latest`）：

```yaml
global:
  imageTag: v0.1.0
```

---

## 6. 安装

```sh
kubectl create namespace sayknowmind

helm install sayknowmind deploy/helm/sayknowmind \
  -n sayknowmind \
  -f deploy/helm/sayknowmind/values-production.yaml \
  -f deploy/helm/sayknowmind/values-secret.yaml
```

观察 Pod 启动状态：

```sh
kubectl get pods -n sayknowmind -w
```

正常启动顺序（约 1–3 分钟）：
1. `postgres-0` 启动并执行 9 个初始化 SQL（首次安装时）
2. `redis`, `searxng`, `ocr-server` 启动
3. `edgequake` 启动并连接 postgres
4. `ai-server` 启动
5. `web`, `dashboard`, `mcp-server`, `relay-server` 启动

---

## 7. 升级

```sh
helm upgrade sayknowmind deploy/helm/sayknowmind \
  -n sayknowmind \
  -f deploy/helm/sayknowmind/values-production.yaml \
  -f deploy/helm/sayknowmind/values-secret.yaml \
  --set global.imageTag=v0.1.1
```

Chart 会在 Pod 注解中记录 `configmap-app.yaml` 和 `secret.yaml` 的 SHA256 校验和。
当 ConfigMap 或 Secret 内容变化时，Pod 会**自动滚动重启**，无需手动操作。

---

## 8. 数据库初始化脚本

PostgreSQL 镜像的 `docker-entrypoint.sh` 会按字母顺序执行 `/docker-entrypoint-initdb.d/` 目录下的所有 `*.sql` 和 `*.sh` 文件，**仅在 PGDATA 为空（即首次初始化）时执行**。

本 Chart 包含 9 个初始化文件，源自仓库根目录 `db/init/`：

```
01-edgequake-init.sql      EdgeQuake 表与 schema
02-init-age-db.sh          初始化 Apache AGE 图数据库
03-init-extensions.sql     启用 pgvector 等扩展
04-sayknowmind-init.sql    主应用 schema
05-ingestion-jobs.sql      数据摄取任务表
06-privacy-levels.sql      隐私级别枚举
07-better-auth.sql         认证相关表
08-relay-sync.sql          中继同步表
09-sync-ledger.sql         同步日志表
```

#### 同步源文件

每当 `db/init/` 目录有更新时，需重新同步到 Chart：

```sh
make helm-sync-db-init
```

> Helm 的 `.Files.Glob` 不能访问 Chart 外部的文件，因此 `db/init/` 必须镜像复制到 Chart 内的 `db-init/` 目录。

#### 强制重新执行初始化

如需在已有数据库上重新执行初始化（**会清空所有数据**）：

```sh
kubectl delete statefulset sayknowmind-postgres -n sayknowmind
kubectl delete pvc data-sayknowmind-postgres-0 -n sayknowmind
helm upgrade sayknowmind deploy/helm/sayknowmind -n sayknowmind ...
```

---

## 9. 目录结构

```
deploy/helm/sayknowmind/
├── Chart.yaml                       # Chart 元数据
├── values.yaml                      # 默认配置
├── values-staging.yaml              # 测试环境覆盖
├── values-production.yaml           # 生产环境覆盖
├── values-secret.example.yaml       # 密钥模板（拷贝为 values-secret.yaml 后填值）
├── README.md                        # 英文版部署文档
├── README.zh-CN.md                  # 本文档
├── .helmignore
├── db-init/                         # /db/init/ 镜像（通过 make helm-sync-db-init 同步）
├── files/
│   └── searxng-settings.yml         # SearXNG 配置文件
└── templates/
    ├── _helpers.tpl                 # 公共模板函数
    ├── serviceaccount.yaml
    ├── secret.yaml                  # 11 个密钥
    ├── configmap-app.yaml           # 非密钥环境变量
    ├── configmap-db-init.yaml       # 数据库初始化 SQL
    ├── postgres.yaml                # StatefulSet + Headless Service
    ├── redis.yaml
    ├── ollama.yaml                  # 受 ollama.enabled 控制
    ├── ipfs.yaml                    # 受 ipfs.enabled 控制
    ├── searxng.yaml                 # 含 ConfigMap
    ├── edgequake.yaml
    ├── ai-server.yaml               # Deployment + 模型缓存 PVC
    ├── ocr-server.yaml
    ├── web.yaml
    ├── dashboard.yaml
    ├── mcp-server.yaml
    ├── relay-server.yaml
    ├── ingress.yaml
    └── NOTES.txt                    # 安装后提示
```

---

## 10. 验证

#### 渲染检查（不实际部署）

```sh
make helm-template          # 使用 staging values 渲染
make helm-lint              # 语法检查

# 或手动渲染并保存到文件
helm template sayknowmind deploy/helm/sayknowmind \
  -f deploy/helm/sayknowmind/values-production.yaml \
  -f deploy/helm/sayknowmind/values-secret.yaml \
  > /tmp/rendered.yaml
```

#### 健康端点（部署后）

所有服务均提供健康检查端点，Chart 已配置 livenessProbe 与 readinessProbe：

| 服务         | 端点路径        |
|--------------|-----------------|
| web          | `/api/health`   |
| ai-server    | `/health`       |
| edgequake    | `/health`       |
| mcp-server   | `/health`       |
| relay-server | `/health`       |
| ocr-server   | `/health`       |

集群内验证：

```sh
kubectl run -it --rm probe --image=curlimages/curl --restart=Never -- \
  curl -s http://sayknowmind-web:3000/api/health
```

---

## 11. 已知约束

1. **`ai-server` 不可水平扩展**
   模型缓存使用 `ReadWriteOnce` 模式 PVC，多副本无法共享。如需扩展，方案有二：
   - 切换到 `ReadWriteMany` StorageClass（NFS / EFS / CephFS）
   - 移除 PVC，每个 Pod 启动时重新下载模型（成本高）

2. **`postgres` 为单副本**
   适用于中小规模部署。如需高可用，建议使用专业 Postgres Operator：
   - [CloudNativePG](https://cloudnative-pg.io/)（推荐）
   - [Zalando postgres-operator](https://github.com/zalando/postgres-operator)
   - [Crunchy Data PGO](https://access.crunchydata.com/documentation/postgres-operator/)

   切换方法：在 `values.yaml` 中设置 `postgres.enabled: false`，并通过环境变量将 `DATABASE_URL` 指向外部数据库。

3. **`ollama` 与 `ipfs` 默认禁用**
   云部署模式（`app.deployMode: cloud`）使用外部 LLM API（OpenAI / OpenRouter / Z.AI），无需本地推理。
   如需启用：在 values 中设置对应组件的 `enabled: true`。

4. **NEXT_PUBLIC_* 构建期固化**
   见第 3 节。修改 web/dashboard 对外域名时必须重建镜像。

---

## 12. 常见问题排查

#### Pod 一直 CrashLoopBackOff
```sh
kubectl describe pod <pod-name> -n sayknowmind
kubectl logs <pod-name> -n sayknowmind --previous
```

最常见原因：
- ❌ Secret 未填写或填写错误（5 个必填项至少有一个为 `REPLACE_ME` 占位符）
- ❌ Postgres 镜像未包含 pgvector / AGE 扩展（使用了官方镜像而非自建镜像）
- ❌ `imagePullSecrets` 未配置（私有仓库）

#### Postgres 启动后 init SQL 未执行
- ✅ 仅在 `PGDATA` 目录为空时执行；如目录已有数据则跳过
- 检查日志：`kubectl logs sayknowmind-postgres-0 -n sayknowmind | head -100`
- 重新初始化方法见第 8 节末尾

#### 域名访问 502/503
- 检查 cert-manager 是否成功签发证书：
  ```sh
  kubectl get certificate -n sayknowmind
  kubectl describe certificate sayknowmind-tls -n sayknowmind
  ```
- 检查 Ingress 后端 Service 是否就绪：
  ```sh
  kubectl get endpoints -n sayknowmind
  ```

#### web/dashboard 域名跳转错误
- 90% 是构建镜像时 `NEXT_PUBLIC_APP_URL` / `BETTER_AUTH_URL` 未传入或传入了错误的值
- 解决：按第 3 节重新构建镜像

---

## 13. 卸载

```sh
helm uninstall sayknowmind -n sayknowmind

# 卸载不会自动删除 PVC（保护数据），如需彻底清理：
kubectl delete pvc --all -n sayknowmind
kubectl delete namespace sayknowmind
```

---

## 14. 联系与反馈

- 项目仓库：https://github.com/sayknowmind/sayknowmind
- Chart 相关问题：请在 issue 中标注 `[helm]` 标签
- 安全问题：请通过私密渠道联系维护者，**勿在 issue 中提交**
