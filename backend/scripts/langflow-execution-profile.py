def _sigap_install_profile(component):
    """Instrument this request's graph only; never alter a shared native class."""
    import functools
    import json
    import secrets
    import time
    import types

    graph = component.get_vertex().graph
    if getattr(graph, '_sigap_profiled', False):
        return
    graph._sigap_profiled = True
    run = secrets.token_hex(4)
    path = __SIGAP_PROFILE_PATH__

    def measured(original, phase, name):
        @functools.wraps(original)
        async def call(*args, **kwargs):
            started = time.perf_counter()
            try:
                return await original(*args, **kwargs)
            finally:
                with open(path, 'a', encoding='utf-8') as output:
                    output.write(json.dumps({'run':run,'phase':phase,'component':name,
                                             'ms':round((time.perf_counter()-started)*1000)})+'\n')
        return call

    for vertex in graph.vertices:
        vertex._log_transaction_async = measured(vertex._log_transaction_async, 'transaction', vertex.display_name)
        vertex.steps = [measured(step, 'step:'+step.__name__, vertex.display_name) for step in vertex.steps]

    original = type(graph)._execute_tasks
    scope = original.__globals__.copy()
    scope['log_vertex_build'] = measured(scope['log_vertex_build'], 'vertex_build', 'graph')
    # A request-local function copy keeps the original code/closure and changes
    # only the profiling wrapper in its private globals. Other runs are untouched.
    cloned = types.FunctionType(original.__code__, scope, original.__name__,
                                original.__defaults__, original.__closure__)
    cloned.__kwdefaults__ = original.__kwdefaults__
    graph._execute_tasks = types.MethodType(cloned, graph)
