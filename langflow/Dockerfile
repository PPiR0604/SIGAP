# Verified official multi-architecture release. No mutable latest tag.
FROM langflowai/langflow:1.12.6@sha256:a0396e089eb97fa471ef8affc492b8c56abb3758040a5ddaa80814b0abad15bf

USER root
WORKDIR /app/sigap-mcp
COPY --chown=1000:1000 components ./components
COPY --chown=1000:1000 lib ./lib
COPY --chown=1000:1000 flows/*.json ./flows/
COPY --chown=1000:1000 scripts/build_supabase_flows.py ./scripts/build_supabase_flows.py
COPY --chown=1000:1000 deploy ./deploy
RUN python scripts/build_supabase_flows.py \
    && python -c "from pathlib import Path; from deploy.runtime import validate_flows; validate_flows(Path('flows/supabase'))"
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DO_NOT_TRACK=true
USER 1000
EXPOSE 10000
ENTRYPOINT ["python", "-m", "deploy.start"]
