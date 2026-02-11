# --------------------------------------------------------------------------
# Adopt the existing shipsec-dev GKE cluster into Terraform.
# The cluster was created imperatively on the default VPC, so we reference
# the network/subnet as data sources rather than managing them.
# --------------------------------------------------------------------------

locals {
  services = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each = local.services
  project  = var.project_id
  service  = each.value

  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repo_name
  format        = "DOCKER"

  depends_on = [google_project_service.enabled]
}

# The cluster lives on the default VPC — we don't manage it, just reference it.
data "google_compute_network" "default" {
  project = var.project_id
  name    = "default"
}

data "google_compute_subnetwork" "default" {
  project = var.project_id
  region  = var.region
  name    = "default"
}

resource "google_container_cluster" "gke" {
  project  = var.project_id
  name     = var.cluster_name
  location = var.zone

  deletion_protection      = false
  initial_node_count       = 1

  release_channel {
    channel = "REGULAR"
  }

  network    = data.google_compute_network.default.id
  subnetwork = data.google_compute_subnetwork.default.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-shipsec-dev-pods-0a61f82c"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # initial_node_count drifts to 0 after remove_default_node_pool removes it.
  # node_config/node_pool are managed by the separate google_container_node_pool resource.
  lifecycle {
    ignore_changes = [initial_node_count, node_config, node_pool]
  }

  depends_on = [google_project_service.enabled]
}

resource "google_container_node_pool" "default_pool" {
  project  = var.project_id
  name     = "default-pool"
  cluster  = google_container_cluster.gke.name
  location = var.zone

  initial_node_count = var.node_count

  node_config {
    machine_type = var.node_machine_type
    disk_type    = "pd-balanced"
    disk_size_gb = var.node_disk_gb
    image_type   = "COS_CONTAINERD"

    oauth_scopes = [
      "https://www.googleapis.com/auth/devstorage.read_only",
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/service.management.readonly",
      "https://www.googleapis.com/auth/servicecontrol",
      "https://www.googleapis.com/auth/trace.append",
    ]
  }
}

# ==========================================================================
# Managed Services: Cloud SQL, Memorystore, GCS
# ==========================================================================

# Private Service Access — allows Cloud SQL and Memorystore to get private IPs
# on the default VPC so GKE pods can reach them without public IPs.
resource "google_compute_global_address" "private_ip_range" {
  project       = var.project_id
  name          = "shipsec-private-ip-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = data.google_compute_network.default.id

  depends_on = [google_project_service.enabled]
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]

  depends_on = [google_project_service.enabled]
}

# --- Cloud SQL (PostgreSQL 16) ---
resource "google_sql_database_instance" "postgres" {
  project          = var.project_id
  name             = "${var.cluster_name}-pg"
  region           = var.region
  database_version = "POSTGRES_16"

  deletion_protection = false

  settings {
    tier              = var.cloudsql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = data.google_compute_network.default.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
      }
    }
  }

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "shipsec" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = "shipsec"
}

resource "google_sql_database" "temporal" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = "temporal"
}

resource "google_sql_user" "shipsec" {
  project  = var.project_id
  instance = google_sql_database_instance.postgres.name
  name     = "shipsec"
  password = var.db_password
}

# --- Memorystore (Redis) ---
resource "google_redis_instance" "redis" {
  project        = var.project_id
  name           = "${var.cluster_name}-redis"
  region         = var.region
  tier           = "BASIC"
  memory_size_gb = var.redis_memory_gb

  authorized_network = data.google_compute_network.default.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  redis_version = "REDIS_7_2"

  depends_on = [google_service_networking_connection.private_vpc]
}

# --- GCS (replaces MinIO for artifact/file storage) ---
resource "google_storage_bucket" "artifacts" {
  project       = var.project_id
  name          = "${var.project_id}-artifacts-${var.cluster_name}"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "Delete"
    }
  }
}

# Service account for GCS access via Workload Identity
resource "google_service_account" "storage" {
  project      = var.project_id
  account_id   = "${var.cluster_name}-storage"
  display_name = "Storage SA for ${var.cluster_name}"
}

resource "google_storage_bucket_iam_member" "storage_admin" {
  bucket = google_storage_bucket.artifacts.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.storage.email}"
}

# Workload Identity binding: allow K8s SA "storage" in shipsec-system
# namespace to impersonate this GCP SA.
resource "google_service_account_iam_member" "storage_wi" {
  service_account_id = google_service_account.storage.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[shipsec-system/storage]"
}

# ==========================================================================
# Outputs
# ==========================================================================

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "cluster_location" {
  value = var.zone
}

output "cluster_name" {
  value = google_container_cluster.gke.name
}

# Cloud SQL
output "database_url" {
  value     = "postgresql://${google_sql_user.shipsec.name}:${var.db_password}@${google_sql_database_instance.postgres.private_ip_address}:5432/shipsec"
  sensitive = true
}

output "cloudsql_private_ip" {
  value = google_sql_database_instance.postgres.private_ip_address
}

# Memorystore
output "redis_url" {
  value = "redis://${google_redis_instance.redis.host}:${google_redis_instance.redis.port}"
}

# GCS (via Workload Identity)
output "gcs_bucket" {
  value = google_storage_bucket.artifacts.name
}

output "gcs_storage_sa_email" {
  value = google_service_account.storage.email
}
