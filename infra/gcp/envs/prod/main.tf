locals {
  services = toset([
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "compute.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each           = local.services
  project            = var.project_id
  service            = each.value
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
  ip_cidr_range = "10.110.0.0/16"

  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = "10.120.0.0/16"
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = "10.130.0.0/20"
  }
}

resource "google_compute_router" "router" {
  project = var.project_id
  region  = var.region
  name    = "${var.cluster_name}-router"
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  project = var.project_id
  region  = var.region
  name    = "${var.cluster_name}-nat"
  router  = google_compute_router.router.name

  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"

  subnetwork {
    name                    = google_compute_subnetwork.subnet.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_container_cluster" "gke" {
  project  = var.project_id
  name     = var.cluster_name
  location = var.region

  deletion_protection      = true
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

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  dynamic "master_authorized_networks_config" {
    for_each = length(var.master_authorized_cidrs) > 0 ? [1] : []
    content {
      dynamic "cidr_blocks" {
        for_each = var.master_authorized_cidrs
        content {
          cidr_block   = cidr_blocks.value.cidr_block
          display_name = cidr_blocks.value.display_name
        }
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_container_node_pool" "system" {
  project  = var.project_id
  name     = "system-pool"
  cluster  = google_container_cluster.gke.name
  location = var.region

  autoscaling {
    min_node_count = var.system_pool_min
    max_node_count = var.system_pool_max
  }

  node_config {
    machine_type = var.system_pool_machine_type
    disk_type    = "pd-balanced"
    disk_size_gb = var.node_disk_gb
    image_type   = "COS_CONTAINERD"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }
}

resource "google_container_node_pool" "exec" {
  project  = var.project_id
  name     = "exec-pool"
  cluster  = google_container_cluster.gke.name
  location = var.region

  autoscaling {
    min_node_count = var.exec_pool_min
    max_node_count = var.exec_pool_max
  }

  node_config {
    machine_type = var.exec_pool_machine_type
    disk_type    = "pd-balanced"
    disk_size_gb = var.node_disk_gb
    image_type   = "COS_CONTAINERD"

    taint {
      key    = "shipsec.io/exec"
      value  = "true"
      effect = "NO_SCHEDULE"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }
}

output "artifact_registry_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "cluster_location" {
  value = var.region
}

output "cluster_name" {
  value = google_container_cluster.gke.name
}

