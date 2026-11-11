#!/bin/bash
set -euo pipefail
base=20261109164020
sha=$(sha256sum /sigap/local/schema-baseline.sql | cut -d ' ' -f 1)
exists=$(psql -X -A -t -v ON_ERROR_STOP=1 -c "select to_regclass('sigap_private.local_installation') is not null")
if [ "$exists" = f ]; then
  occupied=$(psql -X -A -t -v ON_ERROR_STOP=1 -c "select to_regclass('public.sigap_entities') is not null or to_regnamespace('sigap_private') is not null")
  if [ "$occupied" != f ]; then echo 'Local database is not empty; refusing to initialize.' >&2; exit 1; fi
  psql -X -v ON_ERROR_STOP=1 -v baseline_sha="$sha" --single-transaction -f /sigap/local/schema-baseline.sql -f /sigap/local/seed-schema.sql >/dev/null
else
  recorded=$(psql -X -A -t -v ON_ERROR_STOP=1 -c "select sha256 from sigap_private.local_schema_migrations where version='$base'")
  if [ "$recorded" != "$sha" ]; then echo 'Local baseline differs; refusing to overwrite data.' >&2; exit 1; fi
fi
psql -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
\getenv gateway_secret SIGAP_SUPABASE_GATEWAY_SECRET
select 1 / case when exists(select 1 from sigap_private.gateway_secret where id=true and secret=:'gateway_secret') then 1 else 0 end;
SQL
for file in /sigap/migrations/*.sql; do
  [ -e "$file" ] || continue
  version=$(basename "$file" | cut -d _ -f 1)
  [[ "$version" =~ ^[0-9]{14}$ ]] || { echo 'Invalid migration filename.' >&2; exit 1; }
  [[ "$version" > "$base" ]] || continue
  digest=$(sha256sum "$file" | cut -d ' ' -f 1)
  previous=$(psql -X -A -t -v ON_ERROR_STOP=1 -c "select sha256 from sigap_private.local_schema_migrations where version='$version'")
  if [ -n "$previous" ]; then
    [ "$previous" = "$digest" ] || { echo 'Installed migration changed; refusing to continue.' >&2; exit 1; }
    continue
  fi
  psql -X -v ON_ERROR_STOP=1 --single-transaction -f "$file" -c "insert into sigap_private.local_schema_migrations(version,sha256) values('$version','$digest')" >/dev/null
done
psql -X -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema'" >/dev/null
echo 'SIGAP local schema ready.'
