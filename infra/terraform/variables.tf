variable "aws_region" {
  description = "Primary AWS region."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (staging | production)."
  type        = string
  default     = "staging"
}

variable "project" {
  description = "Project slug used in resource naming."
  type        = string
  default     = "harbor"
}

variable "hosted_zone_domain" {
  description = "The Route 53 hosted zone this stack creates records under. For staging this is a delegated subdomain (e.g. lab.harboroffice.ai) so we do not disturb the production apex's Namecheap DNS / Google Workspace email."
  type        = string
  default     = "lab.harboroffice.ai"
}

variable "app_fqdn_override" {
  description = "If empty, the app is served at the hosted_zone_domain apex. Set this only if you want a sub-sub like 'app.lab.harboroffice.ai'."
  type        = string
  default     = ""
}

# ---- VPC ----
variable "vpc_cidr" {
  description = "CIDR for the VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across."
  type        = number
  default     = 2
}

# ---- RDS ----
variable "rds_engine_version" {
  description = "Postgres engine version for RDS."
  type        = string
  default     = "16.3"
}

variable "rds_instance_class" {
  description = "RDS instance class for staging."
  type        = string
  default     = "db.t4g.medium"
}

variable "rds_allocated_storage_gb" {
  description = "Initial storage size in GB."
  type        = number
  default     = 50
}

variable "rds_max_allocated_storage_gb" {
  description = "Autoscaling ceiling for storage in GB."
  type        = number
  default     = 200
}

variable "rds_backup_retention_days" {
  description = "Automated backup retention window."
  type        = number
  default     = 14
}

variable "rds_multi_az" {
  description = "Enable Multi-AZ for RDS (bump to true for production)."
  type        = bool
  default     = false
}

variable "rds_database_name" {
  description = "Initial database name."
  type        = string
  default     = "harbor"
}

variable "rds_master_username" {
  description = "RDS master username (secret stored in SSM)."
  type        = string
  default     = "harbor_admin"
}

# ---- ECS ----
variable "app_image_tag" {
  description = "Image tag to pull from ECR for the app service."
  type        = string
  default     = "latest"
}

variable "app_cpu" {
  description = "CPU units for the app task."
  type        = number
  default     = 1024
}

variable "app_memory" {
  description = "Memory (MiB) for the app task."
  type        = number
  default     = 2048
}

variable "app_desired_count" {
  description = "Desired number of running tasks."
  type        = number
  default     = 2
}

variable "app_container_port" {
  description = "Port the app container listens on."
  type        = number
  default     = 3000
}

# ---- Observability ----
variable "log_retention_days" {
  description = "CloudWatch Logs retention period in days for ECS task logs and VPC flow logs."
  type        = number
  default     = 90
}

variable "ses_from_address" {
  description = "Default SES From address (must be within the hosted zone domain)."
  type        = string
}
