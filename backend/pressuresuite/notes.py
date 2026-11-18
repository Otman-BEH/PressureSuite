"""Notes returned with a result.

- "critical": things people must know (mostly safety), shown in red
- "note": something about this result worth acting on, shown in yellow
- "assumption": a standing modelling assumption, shown collapsed
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class NoteOut(BaseModel):
    level: Literal["note", "critical", "assumption"]
    text: str


def note(text: str) -> NoteOut:
    return NoteOut(level="note", text=text)


def assumption(text: str) -> NoteOut:
    return NoteOut(level="assumption", text=text)


def critical(text: str) -> NoteOut:
    return NoteOut(level="critical", text=text)


def energy_text(kj: float) -> str:
    """Energy for note text: J, kJ or MJ with three significant figures."""
    if kj >= 1e3:
        return f"{kj / 1e3:.3g} MJ"
    return f"{kj:.3g} kJ" if kj >= 1 else f"{kj * 1e3:.3g} J"
