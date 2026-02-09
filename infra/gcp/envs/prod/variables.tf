variable "project_id" {
  type        = string
  description = "GCP project id (e.g. shipsec)."
}

variable "region" {
  type        = string
  description = "GCP region for a regional prod cluster (e.g. us-central1)."
  default     = "us-central1"
}

variable "cluster_name" {
  type        = string
  description = "GKE cluster name."
  default     = "shipsec-prod"
}

variable "artifact_repo_name" {
  type        = string
  description = "Artifact Registry repo name (Docker)."
  default     = "shipsec-studio"
}

variable "master_authorized_cidrs" {
  type = list(object({
    cidr_block   = string
    display_name = string
  }))
  description = "CIDRs allowed to reach the control plane endpoint."
  default     = []
}

variable "system_pool_machine_type" {
  type        = string
  description = "Machine type for the system node pool."
  default     = "e2-standard-4"
}

variable "exec_pool_machine_type" {
  type        = string
  description = "Machine type for the execution node pool."
  default     = "e2-standard-4"
}

variable "system_pool_min" {
  type        = number
  description = "Min nodes for system pool."
  default     = 2
}

variable "system_pool_max" {
  type        = number
  description = "Max nodes for system pool."
  default     = 5
}

variable "exec_pool_min" {
  type        = number
  description = "Min nodes for exec pool."
  default     = 1
}

variable "exec_pool_max" {
  type        = number
  description = "Max nodes for exec pool."
  default     = 4
}

variable "node_disk_gb" {
  type        = number
  description = "Boot disk size (GB)."
  default     = 100
}

