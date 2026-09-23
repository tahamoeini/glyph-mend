FROM mirror.gcr.io/library/node:22-bookworm-slim AS node-runtime

FROM mirror.gcr.io/library/python:3.12-bookworm

ENV CARGO_HOME=/root/.cargo \
    RUSTUP_HOME=/root/.rustup \
    PATH=/root/.cargo/bin:/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl build-essential pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/ /usr/local/

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.97.0 --component rustfmt --component clippy \
    && cargo install cargo-deny --locked --version 0.20.2

WORKDIR /workspace
