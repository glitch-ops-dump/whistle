"""Whistle recommend-only agent service.

A pure-compute companion to the TypeScript ticket spine. It reads governed ticket
projections, runs the intake graph, and returns a recommendation. It holds **no**
write credential to the ticket schema: persistence of the recommendation is done by
the spine (recordAgentRun), so the recommend-only / non-mutation guarantee is structural.
"""

__version__ = "0.1.0"
