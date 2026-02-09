variable "project_id" {
  type        = string
  description = "GCP project id (e.g. shipsec)."
}

variable "region" {
  type        = string
  description = "GCP region (e.g. us-central1)."
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "GCP zone for a zonal dev cluster (e.g. us-central1-a)."
  default     = "us-central1-a"
}

variable "cluster_name" {
  type        = string
  description = "GKE cluster name."
  default     = "shipsec-dev"
}

variable "artifact_repo_name" {
  type        = string
  description = "Artifact Registry repo name (Docker)."
  default     = "shipsec-studio"
}

variable "node_machine_type" {
  type        = string
  description = "Machine type for dev nodes."
  default     = "e2-standard-4"
}

variable "node_count" {
  type        = number
  description = "Initial node count for the dev node pool."
  default     = 2
}

variable "node_disk_gb" {
  type        = number
  description = "Boot disk size (GB)."
  default     = 100
}

