# Garage's own image is `FROM scratch`: the binary and nothing else — no shell, no `sh -c`. Both the
# server (which assigns its layout on first boot) and the provisioner need one, so this copies that
# same binary, verbatim from the pinned upstream digest, onto Alpine.
#
# Both `FROM` lines are **this repository's own copies** of their upstreams, made by
# `.github/workflows/mirror-images.yml` (W0-T27) and pinned to the upstream digest, which the copy
# shares byte for byte. So a withdrawal upstream can no longer stop this image from building — which
# is exactly how the stack broke three times before this.
FROM ghcr.io/mastrobardo/marketplace/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020 AS upstream

FROM ghcr.io/mastrobardo/marketplace/alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
COPY --from=upstream /garage /usr/local/bin/garage
COPY garage.toml /etc/garage.toml
COPY entrypoint.sh provision.sh /usr/local/bin/
CMD ["/usr/local/bin/entrypoint.sh"]
