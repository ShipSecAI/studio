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

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "cluster_location" {
  value = var.zone
}

output "cluster_name" {
  value = google_container_cluster.gke.name
}
