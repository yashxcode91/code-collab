FROM alpine:3.20

# Prebuild C++ toolchain (g++ + standard headers); never install compilers at runtime
RUN apk add --no-cache g++ musl-dev

# Create unprivileged non-root execution user
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

WORKDIR /workspace
USER 10001:10001

CMD ["g++", "--version"]
