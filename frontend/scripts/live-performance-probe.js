// Execute this function with browser_evaluate in an already authenticated SIGAP tab.
// This probe creates review drafts in its own session and never sends a save decision.
async () => {
  if (window.__sigapPerformance?.runs?.some(run => run.status === 'running')) return { error: 'PROBE_BUSY' };
  // A failed new session must not leave callable methods for an older diagnostic session.
  delete window.__sigapPerformance;
  const auth = JSON.parse(sessionStorage.getItem('sigap_auth_session') || 'null');
  if (!auth?.access_token) return { error: 'LOGIN_REQUIRED' };
  // The open app can refresh its login while a long diagnostic is running.
  // Read that current token at each request; never retain/export an old token.
  const headers = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + JSON.parse(sessionStorage.getItem('sigap_auth_session') || 'null')?.access_token });
  const context = document.querySelector('select[aria-label="Pos komando aktif"]')?.value;
  if (!context) return { error: 'NO_ACTIVE_CONTEXT' };
  const response = await fetch('/api/sessions', { method: 'POST', headers: headers(), body: JSON.stringify({ context_id: context, resume: false }) });
  if (!response.ok) return { error: 'SESSION_FAILED', status: response.status };
  const state = window.__sigapPerformance = { sessionId: (await response.json()).session_id, cursor: 0, runs: [], workspaceRuns: [] };
  state.measureWorkspace = async label => {
    const measurement = { label, status: 'running' };
    state.workspaceRuns.push(measurement);
    try {
      for (const endpoint of ['recovery', 'overview']) {
        const started = performance.now();
        const response = await fetch('/api/sessions/' + state.sessionId + '/' + endpoint, { headers: headers(), signal: AbortSignal.timeout(60000) });
        const data = await response.json();
        measurement[endpoint] = { httpStatus: response.status, ms: Math.round(performance.now() - started), status: data.status, records: data.records?.length, reviews: data.reviews?.length, calculated: data.calculation?.shelters?.length };
        if (!response.ok) throw new Error('Workspace ' + endpoint + ' failed.');
      }
      measurement.status = 'complete';
    } catch (error) { measurement.status = 'failed'; measurement.error = error.message; }
    return measurement;
  };
  state.start = async (body, label) => {
    if (state.runs.some(run => run.status === 'running')) throw new Error('Wait for the current measurement.');
    const run = { label, events: [], status: 'running' };
    state.runs.push(run);
    const controller = new AbortController();
    const stream = await fetch('/api/sessions/' + state.sessionId + '/events?lastEventId=' + state.cursor, { headers: headers(), signal: controller.signal });
    if (!stream.ok) { run.status = 'stream_failed'; return { status: stream.status }; }
    const reader = stream.body.getReader(), decoder = new TextDecoder();
    const waiting = [];
    run.started = performance.now();
    const recordEvent = async event => {
      if (event.batchId && event.batchId !== run.batchId) return;
      run.events.push(event);
      if (event.type === 'processing_completed') {
        run.totalMs = event.ms;
        const response = await fetch('/api/batches/' + run.batchId, { headers: headers() });
        if (!response.ok) throw new Error('Cannot verify batch result.');
        run.batch = await response.json();
        run.status = run.batch.status;
        controller.abort();
      }
    };
    run.stream = (async () => {
      let buffer = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const id = /^id: (.+)$/m.exec(block)?.[1];
            if (id) state.cursor = Math.max(state.cursor, Number(id));
            const type = /^event: (.+)$/m.exec(block)?.[1], raw = /^data: (.+)$/m.exec(block)?.[1];
            if (!type || !raw) continue;
            const data = JSON.parse(raw);
            const event = { type, batchId: data.batch_id, stage: data.stage, code: data.code, ms: Math.round(performance.now() - run.started) };
            if (!run.batchId) waiting.push(event); else await recordEvent(event);
          }
        }
      } catch (error) { if (error.name !== 'AbortError') { run.status = 'stream_error'; run.error = error.message; } }
    })();
    const sent = await fetch('/api/sessions/' + state.sessionId + '/messages', { method: 'POST', headers: headers(), body: JSON.stringify({ request_id: crypto.randomUUID(), ...body }) });
    run.requestMs = Math.round(performance.now() - run.started);
    const data = await sent.json();
    run.batchId = data.batch_id; run.httpStatus = sent.status;
    if (!sent.ok) { run.status = 'request_failed'; run.errorCode = data.error?.code; controller.abort(); }
    else for (const event of waiting) await recordEvent(event);
    return { label, accepted: sent.status === 202, requestMs: run.requestMs };
  };
  state.correct = async (changes, label) => {
    const previous = [...state.runs].reverse().find(run => run.status === 'ready_for_review');
    const record = previous?.batch?.preview?.records?.[0];
    if (!record?.shelter_name || !record.batch_id) return { error: 'NO_VALID_CANDIDATE' };
    const keys = ['total_people', 'total_families', 'male', 'female', 'elderly', 'disability', 'infants_toddlers', 'children', 'pregnant', 'breastfeeding', 'is_estimate', 'stock', 'stock_context', 'urgent_needs', 'unverified_numbers', 'validation_issues', 'reported_at'];
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    return state.start({ text: 'Klarifikasi uji latensi.', correction: { target: { report_id: record.report_id, batch_id: record.batch_id, name: record.shelter_name, village: record.village }, base_key: JSON.stringify(stable(Object.fromEntries(keys.map(key => [key, record[key] ?? null])))), changes } }, label);
  };
  state.summary = () => state.runs.map(run => ({ label: run.label, status: run.status, totalMs: run.totalMs, requestMs: run.requestMs, events: run.events.map(({ batchId, ...event }) => event), records: run.batch?.preview?.records?.map(record => ({ name: record.shelter_name, people: record.total_people, male: record.male, female: record.female })), water: run.batch?.gap?.shelters?.map(record => record.needs?.air_liter_per_hari?.value) }));
  return { probeReady: true };
}
