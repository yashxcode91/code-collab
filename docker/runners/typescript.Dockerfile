FROM node:22-alpine

# Install TypeScript compiler and Node types ahead of time so no package download happens during execution
RUN npm install -g typescript@5.7.3 @types/node@22 && npm cache clean --force

# Create unprivileged non-root execution user
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

WORKDIR /workspace
USER 10001:10001

CMD ["tsc", "--version"]
