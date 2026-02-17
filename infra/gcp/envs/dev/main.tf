locals {
  services = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
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

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = "${var.cluster_name}-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

resource "google_compute_subnetwork" "subnet" {
  project       = var.project_id
  region        = var.region
  name          = "${var.cluster_name}-subnet"
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.10.0.0/16"

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.20.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.30.0.0/20"
  }
}

resource "google_container_cluster" "gke" {
  project  = var.project_id
  name     = var.cluster_name
  location = var.zone

  deletion_protection      = false
  remove_default_node_pool = true
  initial_node_count       = 1

  release_channel {
    channel = "REGULAR"
  }

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.subnet.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  addons_config {
    gcs_fuse_csi_driver_config {
      enabled = true
    }
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
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }
}

# --- GCS FUSE volume support ---

# GCS bucket for job volumes
resource "google_storage_bucket" "volumes" {
  project                     = var.project_id
  name                        = "${var.project_id}-volumes-${var.cluster_name}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

# GCP SA for job pods (mounted via GCS FUSE CSI)
resource "google_service_account" "job_runner" {
  project      = var.project_id
  account_id   = "shipsec-job-runner"
  display_name = "ShipSec K8s Job Runner"
}

# Job runner SA → bucket access
resource "google_storage_bucket_iam_member" "job_runner_storage" {
  bucket = google_storage_bucket.volumes.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.job_runner.email}"
}

# Workload Identity: K8s SA → GCP SA (for job pods in shipsec-workloads)
resource "google_service_account_iam_member" "job_runner_wi" {
  service_account_id = google_service_account.job_runner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[shipsec-workloads/shipsec-job-runner]"
}

# Worker SA also needs GCS access (to upload inputs / read outputs via SDK)
resource "google_service_account" "worker" {
  project      = var.project_id
  account_id   = "shipsec-worker"
  display_name = "ShipSec Worker"
}

resource "google_storage_bucket_iam_member" "worker_storage" {
  bucket = google_storage_bucket.volumes.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_service_account_iam_member" "worker_wi" {
  service_account_id = google_service_account.worker.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[shipsec-workers/shipsec-worker]"
}

output "gcs_volumes_bucket" {
  value = google_storage_bucket.volumes.name
}

output "job_runner_sa_email" {
  value = google_service_account.job_runner.email
}

output "worker_sa_email" {
  value = google_service_account.worker.email
}

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "cluster_location" {
  value = var.zone
}

output "cluster_name" {
  value = google_container_cluster.gke.name
}
