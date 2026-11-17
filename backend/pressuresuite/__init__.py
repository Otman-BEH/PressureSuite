"""pressuresuite: real-gas engineering tools for high-pressure gas systems.

- `pressuresuite/<tool>/`: one package per tool with its physics (plain Python, no web code), e.g. `cascade_fill/`.
- `pressuresuite/api/`: the HTTP layer. `app.py` sets up the service; `routes/` has one file per tool.
- `config.py` and `thermo.py` are shared by every tool: paths, constants, units and the CoolProp wrapper.

The physics can be used from a script without the server:

    from pressuresuite.cascade_fill import simulate, SimulateRequest
"""
