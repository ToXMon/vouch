# Vouch Agent Runtime — FastAPI service orchestrating Venice AI agents + three.ws.
# Build context: vouch/ directory (so sibling agent packages are copyable).
#
#   docker build -t vouch-runtime -f agents/runtime/Dockerfile .
#

FROM python:3.11-slim

# Prevent Python from writing .pyc files and buffer stdout/stderr.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first for better layer caching.
COPY agents/runtime/requirements.txt /app/agents/runtime/requirements.txt
RUN pip install --no-cache-dir -r /app/agents/runtime/requirements.txt

# Copy the runtime package and sibling agent packages needed at import time.
# architect/ is implemented; auditor/ and adjudicator/ are optional at runtime.
COPY agents/runtime/ /app/agents/runtime/
COPY agents/architect/ /app/agents/architect/
COPY agents/auditor/ /app/agents/auditor/
COPY agents/adjudicator/ /app/agents/adjudicator/

# Ensure Python can resolve agents.* packages.
ENV PYTHONPATH=/app

EXPOSE 8000

# Run uvicorn serving the FastAPI app.
# Workers can be scaled via UVICORN_WORKERS env var at runtime.
CMD ["sh", "-c", "uvicorn agents.runtime.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1}"]
