FROM python:3.12-alpine

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Create unprivileged non-root execution user
RUN addgroup -g 10001 -S runner && adduser -u 10001 -S runner -G runner

WORKDIR /workspace
USER 10001:10001

CMD ["python3", "--version"]
