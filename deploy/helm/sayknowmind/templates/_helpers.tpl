{{/* =====================================================================
     Common helpers
     ===================================================================== */}}

{{- define "sayknowmind.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sayknowmind.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "sayknowmind.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels applied to every resource */}}
{{- define "sayknowmind.labels" -}}
helm.sh/chart: {{ include "sayknowmind.chart" . }}
app.kubernetes.io/name: {{ include "sayknowmind.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: sayknowmind
{{- end -}}

{{/* Per-component selector labels */}}
{{- define "sayknowmind.componentLabels" -}}
{{ include "sayknowmind.labels" . }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "sayknowmind.componentSelector" -}}
app.kubernetes.io/name: {{ include "sayknowmind.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Service account name */}}
{{- define "sayknowmind.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "sayknowmind.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* =====================================================================
     Image resolution
     -- Each component can set image: "" to use the registry default,
     -- or override with a fully-qualified image string.
     ===================================================================== */}}
{{- define "sayknowmind.image" -}}
{{- $component := .component -}}
{{- $cfg := .config -}}
{{- $g := .root.Values.global -}}
{{- $tag := default $g.imageTag $cfg.tag -}}
{{- if $cfg.image -}}
{{ $cfg.image }}
{{- else if and (eq $component "web") (eq (default "saas" .root.Values.app.authMode) "local") -}}
{{- /* The web client bakes NEXT_PUBLIC_AUTH_MODE at BUILD time, so the open
       (local-auth) edition needs a separately-built image. Derive it from
       app.authMode so the client edition can never diverge from the runtime
       NEXT_PUBLIC_AUTH_MODE the configmap injects (CODE-REVIEW C11). CI builds
       both `-web` (saas) and `-web-local` (local). */ -}}
{{ printf "%s/%s-web-local:%s" $g.registry $g.imagePrefix $tag }}
{{- else -}}
{{ printf "%s/%s-%s:%s" $g.registry $g.imagePrefix $component $tag }}
{{- end -}}
{{- end -}}

{{/* =====================================================================
     Internal Service DNS
     -- Service names are <fullname>-<component>; cluster DNS resolves
     -- them as <name>.<namespace>.svc.<clusterDomain>.
     ===================================================================== */}}
{{- define "sayknowmind.svcHost" -}}
{{- printf "%s-%s" (include "sayknowmind.fullname" .root) .component -}}
{{- end -}}

{{- define "sayknowmind.svcUrl" -}}
{{- $host := include "sayknowmind.svcHost" . -}}
{{- printf "http://%s:%v" $host .port -}}
{{- end -}}

{{/* Postgres DSN built from secret + service host */}}
{{- define "sayknowmind.databaseUrl" -}}
{{- $host := include "sayknowmind.svcHost" (dict "root" . "component" "postgres") -}}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s" .Values.postgres.user $host .Values.postgres.port .Values.postgres.database -}}
{{- end -}}

{{/* Trusted origins string: explicit values, or auto-derived from ingress hosts */}}
{{- define "sayknowmind.trustedOrigins" -}}
{{- if .Values.app.trustedOrigins -}}
{{ join "," .Values.app.trustedOrigins }}
{{- else -}}
{{- $scheme := ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- printf "%s://%s,%s://%s" $scheme .Values.ingress.hosts.web $scheme .Values.ingress.hosts.dashboard -}}
{{- end -}}
{{- end -}}

{{/* Public BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL */}}
{{- define "sayknowmind.webPublicUrl" -}}
{{- $scheme := ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- printf "%s://%s" $scheme .Values.ingress.hosts.web -}}
{{- end -}}

{{- define "sayknowmind.aiPublicUrl" -}}
{{- $scheme := ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- printf "%s://%s" $scheme .Values.ingress.hosts.ai -}}
{{- end -}}

{{- define "sayknowmind.relayPublicUrl" -}}
{{- $scheme := ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- printf "%s://%s" $scheme .Values.ingress.hosts.relay -}}
{{- end -}}

{{- define "sayknowmind.dashboardPublicApiUrl" -}}
{{- $scheme := ternary "https" "http" .Values.ingress.tls.enabled -}}
{{- printf "%s://%s" $scheme .Values.ingress.hosts.ai -}}
{{- end -}}

{{/* =====================================================================
     Pod-level scheduling defaults injection
     ===================================================================== */}}
{{- define "sayknowmind.podDefaults" -}}
{{- with .Values.podDefaults.nodeSelector }}
nodeSelector:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.podDefaults.tolerations }}
tolerations:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.podDefaults.affinity }}
affinity:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.podDefaults.priorityClassName }}
priorityClassName: {{ . }}
{{- end }}
{{- with .Values.podDefaults.topologySpreadConstraints }}
topologySpreadConstraints:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
