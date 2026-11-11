"""Read a sanitized flow JSON from stdin; profile construction, never execution.

Run with the installed Langflow Python. Configuration uses a disposable directory.
The output contains timings and function names, never component values or source.
"""
import copy
import cProfile
import json
import os
from pathlib import Path
import pstats
import sys
import tempfile
import time

flow = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='sigap-langflow-profile-') as directory:
    os.environ['LANGFLOW_CONFIG_DIR'] = directory
    from lfx.graph.graph.base import Graph

    profiler = cProfile.Profile()
    samples = []
    for index in range(3):
        started = time.perf_counter()
        profiler.enable()
        graph = Graph.from_payload(copy.deepcopy(flow['data']), flow_id=flow['id'],
                                   emit_extension_events=False)
        profiler.disable()
        samples.append({'index': index, 'ms': round((time.perf_counter()-started)*1000),
                        'vertices': len(graph.vertices)})
    stats = pstats.Stats(profiler)
    hottest = sorted(stats.stats.items(), key=lambda item: item[1][3], reverse=True)[:18]
    print(json.dumps({'executed_flow': False, 'samples': samples, 'functions': [
        {'file': Path(key[0]).name, 'line': key[1], 'function': key[2],
         'calls': value[1], 'self_ms': round(value[2]*1000), 'cumulative_ms': round(value[3]*1000)}
        for key, value in hottest]}, indent=2))
