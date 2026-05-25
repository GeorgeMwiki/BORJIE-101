{{/*
Expand the name of the chart.
*/}}
{{- define "borjie.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Fully qualified app name.
*/}}
{{- define "borjie.fullname" -}}
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

{{/*
Chart label.
*/}}
{{- define "borjie.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "borjie.labels" -}}
helm.sh/chart: {{ include "borjie.chart" . }}
{{ include "borjie.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "borjie.selectorLabels" -}}
app.kubernetes.io/name: {{ include "borjie.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/*
Per-component image tag resolution.
*/}}
{{- define "borjie.image" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- $tag := default $root.Values.image.tag $component.tag -}}
{{- printf "%s/%s/%s:%s" $root.Values.image.registry $root.Values.image.repository $component.name $tag -}}
{{- end -}}
