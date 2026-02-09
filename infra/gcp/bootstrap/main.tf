resource "google_storage_bucket" "tfstate" {
  name                        = var.state_bucket_name
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }
}

output "state_bucket_name" {
  value = google_storage_bucket.tfstate.name
}

