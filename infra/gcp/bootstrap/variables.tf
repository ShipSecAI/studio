variable "project_id" {
  type        = string
  description = "GCP project id (e.g. shipsec)."
}

variable "region" {
  type        = string
  description = "GCP region (e.g. us-central1)."
}

variable "state_bucket_name" {
  type        = string
  description = "Globally unique GCS bucket name for Terraform state."
  default     = "shipsec-tfstate"
}

