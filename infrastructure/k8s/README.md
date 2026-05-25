# BORJIE Kubernetes Manifests

Kubernetes manifests for the BORJIE property management platform, organized with Kustomize for environment-specific deployments.

## Structure

```
infrastructure/k8s/
├── base/                    # Base resources
│   ├── namespace.yaml       # borjie namespace
│   ├── configmap.yaml      # Common configuration
│   └── secrets.yaml        # Secret template (override in overlays)
├── api-gateway/            # API Gateway service
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── hpa.yaml            # Horizontal Pod Autoscaler
│   └── ingress.yaml        # Ingress rules
├── apps/                   # Frontend applications
│   ├── estate-manager/     # Manager mobile-first app (Next.js)
│   ├── customer-app/       # Tenant app (Next.js)
│   ├── owner-portal/       # Owner portal (Vite)
│   └── admin-portal/       # Admin portal (Vite)
├── databases/              # Database resources (dev only)
│   ├── postgres-statefulset.yaml
│   └── redis-deployment.yaml
├── monitoring/             # Observability
│   ├── prometheus-config.yaml
│   └── grafana-deployment.yaml
└── overlays/               # Environment-specific configs
    ├── staging/
    │   └── kustomization.yaml
    └── production/
        └── kustomization.yaml
```

## Usage

### Build manifests (dry-run)

```bash
# Staging
kubectl kustomize infrastructure/k8s/overlays/staging

# Production
kubectl kustomize infrastructure/k8s/overlays/production
```

### Deploy

```bash
# Staging
kubectl apply -k infrastructure/k8s/overlays/staging

# Production
kubectl apply -k infrastructure/k8s/overlays/production
```

### Prerequisites

- Kubernetes cluster (minikube, kind, EKS, GKE, AKS)
- [kubectl](https://kubernetes.io/docs/tasks/tools/) with cluster access
- NGINX Ingress Controller (for Ingress resources)
- Container images built and pushed to your registry

### Image build & push

Build and push images before deploying:

```bash
# Build images (from project root)
docker build -f docker/Dockerfile.api -t borjie/api-gateway:latest .
docker build -f docker/Dockerfile.web --build-arg APP_NAME=estate-manager-app --build-arg APP_PATH=apps/estate-manager-app --target nextjs -t borjie/estate-manager-app:latest .
docker build -f docker/Dockerfile.web --build-arg APP_NAME=customer-app --build-arg APP_PATH=apps/customer-app --target nextjs -t borjie/customer-app:latest .
docker build -f docker/Dockerfile.web --build-arg APP_NAME=owner-portal --build-arg APP_PATH=apps/owner-portal --target vite -t borjie/owner-portal:latest .
docker build -f docker/Dockerfile.web --build-arg APP_NAME=admin-portal --build-arg APP_PATH=apps/admin-portal --target vite -t borjie/admin-portal:latest .

# Push to your registry (update tag for staging/production)
docker push <registry>/borjie/api-gateway:latest
# ... etc
```

### Secrets

**Never commit real secrets.** The base `secrets.yaml` contains placeholder values for development. For staging/production:

1. Use Kustomize `secretGenerator` in overlays
2. Use External Secrets Operator with Vault/AWS Secrets Manager
3. Use sealed-secrets or similar

Example overlay secretGenerator:

```yaml
# overlays/production/secret-generator.yaml
secretGenerator:
  - name: borjie-secrets
    envs:
      - .env.production
```

### Production notes

- **Databases**: Use managed PostgreSQL (RDS, Cloud SQL) and Redis (ElastiCache, Memorystore) in production. Exclude `databases/` from the base or use overlays to disable.
- **TLS**: Uncomment and configure the `tls` section in `api-gateway/ingress.yaml` for HTTPS.
- **Domains**: Update Ingress hosts and ConfigMap API URLs in overlays for your domains.
