FROM node:22-alpine

# Create unprivileged non-root execution user
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

WORKDIR /workspace
USER 10001:10001

CMD ["node", "--version"]
