# ZeroClaw — Web Scraper / Crawler (Rust)
#
# This is a placeholder Dockerfile. ZeroClaw is planned as a Rust-based
# web scraper/crawler service. Replace this with a real multi-stage Rust
# build once the crate is implemented.
#
# Expected build:
#   FROM rust:1.82-alpine AS builder
#   WORKDIR /app
#   COPY . .
#   RUN cargo build --release
#
#   FROM alpine:3.20
#   COPY --from=builder /app/target/release/zeroclaw /usr/local/bin/
#   EXPOSE 8081
#   CMD ["zeroclaw"]

FROM alpine:3.20
RUN apk add --no-cache curl
EXPOSE 8081
CMD ["sh", "-c", "echo 'ZeroClaw placeholder — replace with real build' && sleep infinity"]
