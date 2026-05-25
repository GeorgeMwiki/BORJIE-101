# =============================================================================
# S3 Module - Input Variables
# =============================================================================

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment (staging, production)"
  type        = string
}

variable "enable_versioning" {
  description = "Enable S3 versioning"
  type        = bool
  default     = true
}

variable "use_kms" {
  description = "Use KMS encryption instead of AES256"
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "CORS allowed origins for direct uploads"
  type        = list(string)
  default     = ["*"]
}
