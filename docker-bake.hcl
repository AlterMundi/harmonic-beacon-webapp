variable "GIT_SHA" {
  default = ""
}

variable "CREATED_AT" {
  default = ""
}

group "default" {
  targets = ["app", "tapestry", "playlist-bot", "analytics"]
}

target "release" {
  platforms = ["linux/amd64"]
  labels = {
    "org.opencontainers.image.source" = "https://github.com/AlterMundi/harmonic-beacon-webapp"
    "org.opencontainers.image.revision" = GIT_SHA
    "org.opencontainers.image.created" = CREATED_AT
  }
}

target "app" {
  inherits = ["release"]
  context = "."
  dockerfile = "Dockerfile"
  tags = ["ghcr.io/altermundi/harmonic-beacon-app:${GIT_SHA}"]
  args = {
    BEACON_GIT_SHA = GIT_SHA
    BEACON_BUILD_TIME = CREATED_AT
  }
}

target "tapestry" {
  inherits = ["release"]
  context = "."
  dockerfile = "services/tapestry/Dockerfile"
  tags = ["ghcr.io/altermundi/harmonic-beacon-tapestry:${GIT_SHA}"]
}

target "playlist-bot" {
  inherits = ["release"]
  context = "."
  dockerfile = "services/playlist-bot/Dockerfile"
  tags = ["ghcr.io/altermundi/harmonic-beacon-playlist-bot:${GIT_SHA}"]
}

target "analytics" {
  inherits = ["release"]
  context = "."
  dockerfile = "services/analytics/Dockerfile"
  tags = ["ghcr.io/altermundi/harmonic-beacon-analytics:${GIT_SHA}"]
}
