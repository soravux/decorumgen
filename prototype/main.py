#!/usr/bin/env python3
"""
Decorum Scenario Generator Prototype
=====================================
Generates custom scenarios for the Decorum board game:
  1. Generates a valid final (solution) board state with structured patterns
  2. Assigns constraint rules to players (all satisfied by the solution)
  3. Generates an initial board by backward-walking from the solution
  4. Renders constraints in natural language with personality voices

Usage:
    python prototype/main.py                     # Interactive mode
    python prototype/main.py 2 medium            # 2 players, medium difficulty
    python prototype/main.py 3 hard 42           # 3 players, hard, seed=42
"""

import random
import copy
import sys
from dataclasses import dataclass, field
from typing import Optional
from enum import Enum, auto


# ════════════════════════════════════════════════════════════════
# SECTION 1: CONSTANTS & GAME DATA
# ════════════════════════════════════════════════════════════════

COLORS: list[str] = ["Red", "Yellow", "Blue", "Green"]
WARM_COLORS: set[str] = {"Red", "Yellow"}
COOL_COLORS: set[str] = {"Blue", "Green"}

STYLES: list[str] = ["Modern", "Antique", "Retro", "Unusual"]

OBJECT_TYPES: list[str] = ["Lamp", "Wall Hanging", "Curio"]
OBJECT_TYPE_PLURAL: dict[str, str] = {
    "Lamp": "lamps",
    "Wall Hanging": "wall hangings",
    "Curio": "curios",
}

# Fixed style-to-color mapping per object type (from the Decorum rulebook).
# For a given object type, choosing a style uniquely determines the color.
STYLE_TO_COLOR: dict[str, dict[str, str]] = {
    "Lamp": {
        "Modern": "Blue",
        "Antique": "Yellow",
        "Retro": "Red",
        "Unusual": "Green",
    },
    "Wall Hanging": {
        "Modern": "Red",
        "Antique": "Green",
        "Retro": "Blue",
        "Unusual": "Yellow",
    },
    "Curio": {
        "Modern": "Green",
        "Antique": "Blue",
        "Retro": "Yellow",
        "Unusual": "Red",
    },
}

# Reverse mapping: given object type + color -> style
COLOR_TO_STYLE: dict[str, dict[str, str]] = {
    obj_type: {color: style for style, color in mapping.items()}
    for obj_type, mapping in STYLE_TO_COLOR.items()
}

# Room names per player-count variant
ROOMS_2P: list[str] = ["Bathroom", "Bedroom", "Living Room", "Kitchen"]
ROOMS_34P: list[str] = ["Bedroom A", "Bedroom B", "Living Room", "Kitchen"]

# Spatial groupings (house layout)
# 2-player board: Bathroom+Bedroom upstairs, Living Room+Kitchen downstairs
LAYOUT_2P: dict[str, list[str]] = {
    "upstairs": ["Bathroom", "Bedroom"],
    "downstairs": ["Living Room", "Kitchen"],
    "left side": ["Bathroom", "Living Room"],
    "right side": ["Bedroom", "Kitchen"],
}

# 3-4 player board (roommate variant): Bedrooms upstairs, LR+Kitchen downstairs
LAYOUT_34P: dict[str, list[str]] = {
    "upstairs": ["Bedroom A", "Bedroom B"],
    "downstairs": ["Living Room", "Kitchen"],
    "left side": ["Bedroom A", "Living Room"],
    "right side": ["Bedroom B", "Kitchen"],
}

AREA_NAMES: list[str] = ["upstairs", "downstairs", "left side", "right side"]

# Difficulty presets
DIFFICULTY_PARAMS: dict[str, dict] = {
    "easy": {
        "num_colors": 3,
        "num_styles": 3,
        "total_items_range": (5, 7),
        "pattern_prob": 0.35,
        "rules_per_player": 3,
        # Perturbation defaults
        "num_perturbations_range": (3, 5),
        "perturbation_weights": {
            "paint": 1.0, "swap": 1.5, "remove": 0.5, "add": 0.3,
        },
    },
    "medium": {
        "num_colors": 3,
        "num_styles": 4,
        "total_items_range": (6, 9),
        "pattern_prob": 0.30,
        "rules_per_player": 4,
        "num_perturbations_range": (5, 8),
        "perturbation_weights": {
            "paint": 1.0, "swap": 1.5, "remove": 0.8, "add": 0.3,
        },
    },
    "hard": {
        "num_colors": 4,
        "num_styles": 4,
        "total_items_range": (7, 10),
        "pattern_prob": 0.25,
        "rules_per_player": 4,
        "num_perturbations_range": (7, 10),
        "perturbation_weights": {
            "paint": 1.0, "swap": 1.2, "remove": 1.0, "add": 0.5,
        },
    },
}


# ════════════════════════════════════════════════════════════════
# SECTION 2: STATE REPRESENTATION
# ════════════════════════════════════════════════════════════════

@dataclass
class ObjectToken:
    """
    An object token placed in a room slot.
    The style uniquely determines the color for a given object type.
    """
    obj_type: str  # "Lamp", "Wall Hanging", "Curio"
    style: str     # "Modern", "Antique", "Retro", "Unusual"

    @property
    def color(self) -> str:
        return STYLE_TO_COLOR[self.obj_type][self.style]

    def __repr__(self) -> str:
        return f"{self.style} {self.color} {self.obj_type}"

    def __eq__(self, other) -> bool:
        if not isinstance(other, ObjectToken):
            return False
        return self.obj_type == other.obj_type and self.style == other.style

    def __hash__(self) -> int:
        return hash((self.obj_type, self.style))


@dataclass
class Room:
    """A room with a wall color and up to 3 object slots (lamp, wall hanging, curio)."""
    name: str
    wall_color: str
    lamp: Optional[ObjectToken] = None
    wall_hanging: Optional[ObjectToken] = None
    curio: Optional[ObjectToken] = None

    def get_object(self, obj_type: str) -> Optional[ObjectToken]:
        return {"Lamp": self.lamp, "Wall Hanging": self.wall_hanging, "Curio": self.curio}[obj_type]

    def set_object(self, obj_type: str, token: Optional[ObjectToken]) -> None:
        if obj_type == "Lamp":
            self.lamp = token
        elif obj_type == "Wall Hanging":
            self.wall_hanging = token
        elif obj_type == "Curio":
            self.curio = token

    def get_objects(self) -> list[ObjectToken]:
        """Return all non-empty object tokens in this room."""
        return [obj for obj in (self.lamp, self.wall_hanging, self.curio) if obj is not None]

    def object_count(self) -> int:
        return len(self.get_objects())

    def has_style(self, style: str) -> bool:
        return any(obj.style == style for obj in self.get_objects())

    def has_object_color(self, color: str) -> bool:
        return any(obj.color == color for obj in self.get_objects())

    @property
    def all_feature_colors(self) -> list[str]:
        """All colors in this room: wall color + all object colors."""
        return [self.wall_color] + [obj.color for obj in self.get_objects()]


class HouseState:
    """
    The full state of the 4-room house.

    Exposes action methods (add/remove/swap/paint) so that future
    initial-board perturbation can be implemented as a sequence of legal moves.
    """

    def __init__(self, num_players: int):
        self.num_players = num_players
        room_names = ROOMS_2P if num_players == 2 else ROOMS_34P
        self.rooms: dict[str, Room] = {
            name: Room(name=name, wall_color="Red") for name in room_names
        }

    @property
    def room_names(self) -> list[str]:
        return list(self.rooms.keys())

    @property
    def layout(self) -> dict[str, list[str]]:
        return LAYOUT_2P if self.num_players == 2 else LAYOUT_34P

    def get_all_objects(self) -> list[ObjectToken]:
        result = []
        for room in self.rooms.values():
            result.extend(room.get_objects())
        return result

    def get_rooms_in_area(self, area_name: str) -> list[Room]:
        return [self.rooms[rn] for rn in self.layout[area_name]]

    # --- Counting helpers ---

    def count_rooms_with_wall_color(self, color: str) -> int:
        return sum(1 for r in self.rooms.values() if r.wall_color == color)

    def count_objects_with_color(self, color: str) -> int:
        return sum(1 for obj in self.get_all_objects() if obj.color == color)

    def count_objects_with_style(self, style: str) -> int:
        return sum(1 for obj in self.get_all_objects() if obj.style == style)

    def count_objects_of_type(self, obj_type: str) -> int:
        return sum(1 for r in self.rooms.values() if r.get_object(obj_type) is not None)

    def count_warm_objects(self) -> int:
        return sum(1 for obj in self.get_all_objects() if obj.color in WARM_COLORS)

    def count_cool_objects(self) -> int:
        return sum(1 for obj in self.get_all_objects() if obj.color in COOL_COLORS)

    # --- Legal actions (for future initial-board perturbation) ---

    def add_object(self, room_name: str, token: ObjectToken) -> bool:
        """Add an object to an empty slot. Returns True if successful."""
        room = self.rooms[room_name]
        if room.get_object(token.obj_type) is not None:
            return False  # slot occupied
        room.set_object(token.obj_type, token)
        return True

    def remove_object(self, room_name: str, obj_type: str) -> Optional[ObjectToken]:
        """Remove an object from a slot. Returns the removed token or None."""
        room = self.rooms[room_name]
        token = room.get_object(obj_type)
        if token is None:
            return None
        room.set_object(obj_type, None)
        return token

    def swap_object(self, room_name: str, new_token: ObjectToken) -> Optional[ObjectToken]:
        """Swap an object for another of the same type. Returns the old token."""
        room = self.rooms[room_name]
        old = room.get_object(new_token.obj_type)
        if old is None:
            return None  # nothing to swap
        room.set_object(new_token.obj_type, new_token)
        return old

    def paint_room(self, room_name: str, new_color: str) -> str:
        """Paint a room a new color. Returns the old color."""
        old = self.rooms[room_name].wall_color
        self.rooms[room_name].wall_color = new_color
        return old

    def deep_copy(self) -> "HouseState":
        return copy.deepcopy(self)

    def fingerprint(self) -> tuple:
        """
        Hashable fingerprint of the full board configuration.
        Used for cycle detection during backward-walk perturbation.
        Two states with the same fingerprint are identical.
        """
        parts: list = []
        for rn in sorted(self.rooms.keys()):
            room = self.rooms[rn]
            parts.append(room.wall_color)
            for ot in OBJECT_TYPES:
                obj = room.get_object(ot)
                parts.append(obj.style if obj else "")
        return tuple(parts)

    # --- Display ---

    def display(self, label: str = "HOUSE STATE") -> None:
        """Pretty-print the house as a 2x2 grid with optional label."""
        lay = self.layout
        top_row = lay["upstairs"]   # upstairs rooms
        bot_row = lay["downstairs"]  # downstairs rooms

        col_w = 34
        sep = "+" + "-" * col_w + "+" + "-" * col_w + "+"

        print(f"\n{label:^{2 * col_w + 3}}")
        print(f"({self.num_players} players)")
        print()

        for label, row_names in [("UPSTAIRS", top_row), ("DOWNSTAIRS", bot_row)]:
            print(f"  {label}")
            print(sep)
            rooms = [self.rooms[rn] for rn in row_names]

            # Room name + wall color line
            cells = []
            for r in rooms:
                cells.append(f" {r.name} [{r.wall_color} walls]")
            print("|" + "|".join(c.ljust(col_w) for c in cells) + "|")

            # Object lines
            for ot in OBJECT_TYPES:
                cells = []
                for r in rooms:
                    obj = r.get_object(ot)
                    if obj:
                        cells.append(f"   {ot}: {obj.style} {obj.color}")
                    else:
                        cells.append(f"   {ot}: (empty)")
                print("|" + "|".join(c.ljust(col_w) for c in cells) + "|")

            print(sep)
            print()


# ════════════════════════════════════════════════════════════════
# SECTION 3: CONSTRAINT TYPES & EVALUATION
# ════════════════════════════════════════════════════════════════

class CType(Enum):
    """All supported constraint types for scenario generation."""

    # -- Room-specific: wall color --
    ROOM_WALL_COLOR_IS = auto()
    ROOM_WALL_COLOR_IS_NOT = auto()
    ROOM_WALL_WARM = auto()
    ROOM_WALL_COOL = auto()

    # -- Room-specific: object presence --
    ROOM_HAS_OBJECT_TYPE = auto()
    ROOM_NO_OBJECT_TYPE = auto()

    # -- Room-specific: object style --
    ROOM_HAS_STYLE = auto()
    ROOM_NO_STYLE = auto()

    # -- Room-specific: object color --
    ROOM_HAS_COLOR_OBJECT = auto()
    ROOM_NO_COLOR_OBJECT = auto()

    # -- Area (upstairs/downstairs/left/right) --
    AREA_HAS_OBJECT_TYPE = auto()
    AREA_NO_OBJECT_TYPE = auto()
    AREA_HAS_COLOR_OBJECT = auto()
    AREA_NO_COLOR_OBJECT = auto()
    AREA_HAS_STYLE = auto()
    AREA_NO_STYLE = auto()

    # -- Global counts --
    EXACTLY_N_ROOMS_COLOR = auto()
    AT_LEAST_N_OBJECT_TYPE = auto()
    AT_LEAST_N_COLOR_OBJECTS = auto()
    AT_LEAST_N_STYLE_OBJECTS = auto()
    NO_COLOR_OBJECTS_IN_HOUSE = auto()

    # -- Global qualitative --
    ALL_OBJECT_TYPE_SAME_COLOR = auto()
    ALL_OBJECT_TYPE_SAME_STYLE = auto()

    # -- Relational / conditional --
    COLOR_ROOM_COUNT_EQUAL = auto()
    ROOM_WITH_TYPE_MUST_HAVE_TYPE = auto()
    NO_ROOM_MORE_THAN_ONE_STYLE = auto()

    # -- Color temperature --
    AT_LEAST_N_WARM_OBJECTS = auto()
    AT_LEAST_N_COOL_OBJECTS = auto()


@dataclass
class Constraint:
    """
    A ground constraint: a type + parameter dict.
    Can evaluate itself against a HouseState and render to natural language.
    """
    ctype: CType
    params: dict
    score: float = 0.0  # usefulness/interestingness score

    def evaluate(self, state: HouseState) -> bool:
        return evaluate_constraint(self, state)

    def to_nl(self, voice: str = "neutral") -> str:
        return render_nl(self, voice)

    @property
    def _key(self):
        return (self.ctype, tuple(sorted(self.params.items())))

    def __eq__(self, other) -> bool:
        return isinstance(other, Constraint) and self._key == other._key

    def __hash__(self) -> int:
        return hash(self._key)

    def __repr__(self) -> str:
        return f"Constraint({self.ctype.name}, {self.params})"


def evaluate_constraint(c: Constraint, s: HouseState) -> bool:
    """Evaluate whether constraint c is satisfied by state s."""
    t, p = c.ctype, c.params

    # --- Room wall color ---
    if t == CType.ROOM_WALL_COLOR_IS:
        return s.rooms[p["room"]].wall_color == p["color"]
    if t == CType.ROOM_WALL_COLOR_IS_NOT:
        return s.rooms[p["room"]].wall_color != p["color"]
    if t == CType.ROOM_WALL_WARM:
        return s.rooms[p["room"]].wall_color in WARM_COLORS
    if t == CType.ROOM_WALL_COOL:
        return s.rooms[p["room"]].wall_color in COOL_COLORS

    # --- Room object presence ---
    if t == CType.ROOM_HAS_OBJECT_TYPE:
        return s.rooms[p["room"]].get_object(p["obj_type"]) is not None
    if t == CType.ROOM_NO_OBJECT_TYPE:
        return s.rooms[p["room"]].get_object(p["obj_type"]) is None

    # --- Room object style ---
    if t == CType.ROOM_HAS_STYLE:
        return s.rooms[p["room"]].has_style(p["style"])
    if t == CType.ROOM_NO_STYLE:
        return not s.rooms[p["room"]].has_style(p["style"])

    # --- Room object color ---
    if t == CType.ROOM_HAS_COLOR_OBJECT:
        return s.rooms[p["room"]].has_object_color(p["color"])
    if t == CType.ROOM_NO_COLOR_OBJECT:
        return not s.rooms[p["room"]].has_object_color(p["color"])

    # --- Area: object presence ---
    if t == CType.AREA_HAS_OBJECT_TYPE:
        return any(
            r.get_object(p["obj_type"]) is not None
            for r in s.get_rooms_in_area(p["area"])
        )
    if t == CType.AREA_NO_OBJECT_TYPE:
        return all(
            r.get_object(p["obj_type"]) is None
            for r in s.get_rooms_in_area(p["area"])
        )

    # --- Area: object color ---
    if t == CType.AREA_HAS_COLOR_OBJECT:
        return any(
            obj.color == p["color"]
            for r in s.get_rooms_in_area(p["area"])
            for obj in r.get_objects()
        )
    if t == CType.AREA_NO_COLOR_OBJECT:
        return not any(
            obj.color == p["color"]
            for r in s.get_rooms_in_area(p["area"])
            for obj in r.get_objects()
        )

    # --- Area: style ---
    if t == CType.AREA_HAS_STYLE:
        return any(
            obj.style == p["style"]
            for r in s.get_rooms_in_area(p["area"])
            for obj in r.get_objects()
        )
    if t == CType.AREA_NO_STYLE:
        return not any(
            obj.style == p["style"]
            for r in s.get_rooms_in_area(p["area"])
            for obj in r.get_objects()
        )

    # --- Global counts ---
    if t == CType.EXACTLY_N_ROOMS_COLOR:
        return s.count_rooms_with_wall_color(p["color"]) == p["n"]
    if t == CType.AT_LEAST_N_OBJECT_TYPE:
        return s.count_objects_of_type(p["obj_type"]) >= p["n"]
    if t == CType.AT_LEAST_N_COLOR_OBJECTS:
        return s.count_objects_with_color(p["color"]) >= p["n"]
    if t == CType.AT_LEAST_N_STYLE_OBJECTS:
        return s.count_objects_with_style(p["style"]) >= p["n"]
    if t == CType.NO_COLOR_OBJECTS_IN_HOUSE:
        return s.count_objects_with_color(p["color"]) == 0

    # --- Global qualitative ---
    if t == CType.ALL_OBJECT_TYPE_SAME_COLOR:
        objs = [r.get_object(p["obj_type"]) for r in s.rooms.values()
                if r.get_object(p["obj_type"]) is not None]
        if len(objs) < 2:
            return True  # vacuously true (but should be filtered by scoring)
        return all(o.color == p["color"] for o in objs)

    if t == CType.ALL_OBJECT_TYPE_SAME_STYLE:
        objs = [r.get_object(p["obj_type"]) for r in s.rooms.values()
                if r.get_object(p["obj_type"]) is not None]
        if len(objs) < 2:
            return True
        return all(o.style == p["style"] for o in objs)

    # --- Relational ---
    if t == CType.COLOR_ROOM_COUNT_EQUAL:
        return (s.count_rooms_with_wall_color(p["colorA"])
                == s.count_rooms_with_wall_color(p["colorB"]))

    if t == CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE:
        for room in s.rooms.values():
            if (room.get_object(p["obj_typeA"]) is not None
                    and room.get_object(p["obj_typeB"]) is None):
                return False
        return True

    if t == CType.NO_ROOM_MORE_THAN_ONE_STYLE:
        for room in s.rooms.values():
            count = sum(1 for obj in room.get_objects() if obj.style == p["style"])
            if count > 1:
                return False
        return True

    # --- Temperature ---
    if t == CType.AT_LEAST_N_WARM_OBJECTS:
        return s.count_warm_objects() >= p["n"]
    if t == CType.AT_LEAST_N_COOL_OBJECTS:
        return s.count_cool_objects() >= p["n"]

    raise ValueError(f"Unknown constraint type: {t}")


# ════════════════════════════════════════════════════════════════
# SECTION 4: CANDIDATE CONSTRAINT GENERATION
# ════════════════════════════════════════════════════════════════

def generate_candidates(state: HouseState) -> list[Constraint]:
    """
    Enumerate all constraint instances that are TRUE on the given state.
    Each candidate is assigned an interestingness score.
    """
    cands: list[Constraint] = []

    def add(ctype: CType, params: dict, score: float):
        c = Constraint(ctype, params, score)
        assert c.evaluate(state), f"BUG: candidate not true on state: {c}"
        cands.append(c)

    room_names = state.room_names
    total_objects = len(state.get_all_objects())

    # ── Room-specific constraints ──────────────────────────────
    for rn in room_names:
        room = state.rooms[rn]

        # Wall color
        for color in COLORS:
            if room.wall_color == color:
                add(CType.ROOM_WALL_COLOR_IS, {"room": rn, "color": color}, 6.0)
            else:
                add(CType.ROOM_WALL_COLOR_IS_NOT, {"room": rn, "color": color}, 3.0)

        # Wall temperature
        if room.wall_color in WARM_COLORS:
            add(CType.ROOM_WALL_WARM, {"room": rn}, 4.0)
        else:
            add(CType.ROOM_WALL_COOL, {"room": rn}, 4.0)

        # Object presence
        for ot in OBJECT_TYPES:
            if room.get_object(ot) is not None:
                add(CType.ROOM_HAS_OBJECT_TYPE, {"room": rn, "obj_type": ot}, 5.0)
            else:
                add(CType.ROOM_NO_OBJECT_TYPE, {"room": rn, "obj_type": ot}, 4.0)

        # Object style
        for style in STYLES:
            if room.has_style(style):
                add(CType.ROOM_HAS_STYLE, {"room": rn, "style": style}, 5.5)
            else:
                # More interesting if the room has objects but not this style
                sc = 4.5 if room.object_count() > 0 else 2.0
                add(CType.ROOM_NO_STYLE, {"room": rn, "style": style}, sc)

        # Object color
        for color in COLORS:
            if room.has_object_color(color):
                add(CType.ROOM_HAS_COLOR_OBJECT, {"room": rn, "color": color}, 5.0)
            else:
                sc = 4.0 if room.object_count() > 0 else 2.0
                add(CType.ROOM_NO_COLOR_OBJECT, {"room": rn, "color": color}, sc)

    # ── Area constraints ───────────────────────────────────────
    for area in AREA_NAMES:
        area_rooms = state.get_rooms_in_area(area)

        for ot in OBJECT_TYPES:
            has = any(r.get_object(ot) is not None for r in area_rooms)
            if has:
                add(CType.AREA_HAS_OBJECT_TYPE, {"area": area, "obj_type": ot}, 6.0)
            else:
                add(CType.AREA_NO_OBJECT_TYPE, {"area": area, "obj_type": ot}, 5.5)

        for color in COLORS:
            has = any(obj.color == color for r in area_rooms for obj in r.get_objects())
            if has:
                add(CType.AREA_HAS_COLOR_OBJECT, {"area": area, "color": color}, 5.5)
            else:
                area_has_objects = any(r.object_count() > 0 for r in area_rooms)
                sc = 5.0 if area_has_objects else 2.0
                add(CType.AREA_NO_COLOR_OBJECT, {"area": area, "color": color}, sc)

        for style in STYLES:
            has = any(obj.style == style for r in area_rooms for obj in r.get_objects())
            if has:
                add(CType.AREA_HAS_STYLE, {"area": area, "style": style}, 5.5)
            else:
                area_has_objects = any(r.object_count() > 0 for r in area_rooms)
                sc = 5.0 if area_has_objects else 2.0
                add(CType.AREA_NO_STYLE, {"area": area, "style": style}, sc)

    # ── Global count constraints ───────────────────────────────
    for color in COLORS:
        n_walls = state.count_rooms_with_wall_color(color)
        if 1 <= n_walls <= 3:
            # "Exactly N rooms painted <color>" — interesting when N is 1 or 2
            sc = 7.0 if n_walls <= 2 else 5.5
            add(CType.EXACTLY_N_ROOMS_COLOR, {"color": color, "n": n_walls}, sc)

        n_objs = state.count_objects_with_color(color)
        if n_objs == 0:
            add(CType.NO_COLOR_OBJECTS_IN_HOUSE, {"color": color}, 6.0)
        else:
            # Generate "at least N" for the tightest meaningful values
            for k in range(max(1, n_objs - 1), n_objs + 1):
                if k < 1:
                    continue
                # Tighter constraint = higher score
                sc = 4.0 + 2.5 * (k / max(n_objs, 1))
                add(CType.AT_LEAST_N_COLOR_OBJECTS, {"color": color, "n": k}, sc)

    for ot in OBJECT_TYPES:
        count = state.count_objects_of_type(ot)
        if count >= 2:
            # Only generate for meaningful thresholds
            for k in range(max(2, count - 1), count + 1):
                sc = 4.0 + 2.0 * (k / max(count, 1))
                add(CType.AT_LEAST_N_OBJECT_TYPE, {"obj_type": ot, "n": k}, sc)

    for style in STYLES:
        count = state.count_objects_with_style(style)
        if count >= 2:
            for k in range(max(2, count - 1), count + 1):
                sc = 4.0 + 2.0 * (k / max(count, 1))
                add(CType.AT_LEAST_N_STYLE_OBJECTS, {"style": style, "n": k}, sc)

    # ── Global qualitative ─────────────────────────────────────
    for ot in OBJECT_TYPES:
        objs = [r.get_object(ot) for r in state.rooms.values()
                if r.get_object(ot) is not None]
        if len(objs) >= 2:
            # Check if all same color / same style
            colors_present = set(o.color for o in objs)
            styles_present = set(o.style for o in objs)
            if len(colors_present) == 1:
                add(CType.ALL_OBJECT_TYPE_SAME_COLOR,
                    {"obj_type": ot, "color": list(colors_present)[0]}, 7.5)
            if len(styles_present) == 1:
                add(CType.ALL_OBJECT_TYPE_SAME_STYLE,
                    {"obj_type": ot, "style": list(styles_present)[0]}, 7.5)

    # ── Relational / conditional ───────────────────────────────
    for i, cA in enumerate(COLORS):
        for cB in COLORS[i + 1:]:
            if state.count_rooms_with_wall_color(cA) == state.count_rooms_with_wall_color(cB):
                # More interesting if both counts > 0
                both_present = (state.count_rooms_with_wall_color(cA) > 0
                                and state.count_rooms_with_wall_color(cB) > 0)
                sc = 7.5 if both_present else 4.0
                add(CType.COLOR_ROOM_COUNT_EQUAL, {"colorA": cA, "colorB": cB}, sc)

    for tA in OBJECT_TYPES:
        for tB in OBJECT_TYPES:
            if tA == tB:
                continue
            valid = True
            has_typeA = False
            for room in state.rooms.values():
                if room.get_object(tA) is not None:
                    has_typeA = True
                    if room.get_object(tB) is None:
                        valid = False
                        break
            if valid and has_typeA:
                add(CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE,
                    {"obj_typeA": tA, "obj_typeB": tB}, 8.0)

    for style in STYLES:
        valid = True
        style_exists = False
        for room in state.rooms.values():
            count = sum(1 for obj in room.get_objects() if obj.style == style)
            if count >= 1:
                style_exists = True
            if count > 1:
                valid = False
                break
        if valid and style_exists:
            add(CType.NO_ROOM_MORE_THAN_ONE_STYLE, {"style": style}, 6.5)

    # ── Temperature ────────────────────────────────────────────
    warm_ct = state.count_warm_objects()
    cool_ct = state.count_cool_objects()
    if warm_ct >= 2:
        add(CType.AT_LEAST_N_WARM_OBJECTS, {"n": warm_ct}, 5.0)
    if warm_ct >= 3:
        add(CType.AT_LEAST_N_WARM_OBJECTS, {"n": warm_ct - 1}, 4.0)
    if cool_ct >= 2:
        add(CType.AT_LEAST_N_COOL_OBJECTS, {"n": cool_ct}, 5.0)
    if cool_ct >= 3:
        add(CType.AT_LEAST_N_COOL_OBJECTS, {"n": cool_ct - 1}, 4.0)

    return cands


# ════════════════════════════════════════════════════════════════
# SECTION 5: NATURAL LANGUAGE RENDERING
# ════════════════════════════════════════════════════════════════

import re as _re

# All templates use consistent "must" / "must not" / "may" modal verbs
# so the voice system can reliably transform them via regex.
NL_TEMPLATES: dict[CType, list[str]] = {
    # Room wall color
    CType.ROOM_WALL_COLOR_IS: [
        "The {room} must be painted {color}.",
    ],
    CType.ROOM_WALL_COLOR_IS_NOT: [
        "The {room} must not be painted {color}.",
    ],
    CType.ROOM_WALL_WARM: [
        "The {room} must be painted a warm color.",
    ],
    CType.ROOM_WALL_COOL: [
        "The {room} must be painted a cool color.",
    ],
    # Room object presence
    CType.ROOM_HAS_OBJECT_TYPE: [
        "The {room} must contain a {obj_type_lower}.",
    ],
    CType.ROOM_NO_OBJECT_TYPE: [
        "The {room} must not contain a {obj_type_lower}.",
    ],
    # Room object style
    CType.ROOM_HAS_STYLE: [
        "The {room} must contain at least one {style} item.",
    ],
    CType.ROOM_NO_STYLE: [
        "The {room} must not contain any {style} items.",
    ],
    # Room object color
    CType.ROOM_HAS_COLOR_OBJECT: [
        "The {room} must contain at least one {color} object.",
    ],
    CType.ROOM_NO_COLOR_OBJECT: [
        "The {room} must not contain any {color} objects.",
    ],
    # Area
    CType.AREA_HAS_OBJECT_TYPE: [
        "The {area} must contain a {obj_type_lower}.",
    ],
    CType.AREA_NO_OBJECT_TYPE: [
        "The {area} must not contain any {obj_type_plural}.",
    ],
    CType.AREA_HAS_COLOR_OBJECT: [
        "The {area} must contain at least one {color} object.",
    ],
    CType.AREA_NO_COLOR_OBJECT: [
        "The {area} must not contain any {color} objects.",
    ],
    CType.AREA_HAS_STYLE: [
        "The {area} must contain at least one {style} item.",
    ],
    CType.AREA_NO_STYLE: [
        "The {area} must not contain any {style} items.",
    ],
    # Global counts
    CType.EXACTLY_N_ROOMS_COLOR: [
        "Exactly {n} {room_word} must be painted {color}.",
    ],
    CType.AT_LEAST_N_OBJECT_TYPE: [
        "There must be at least {n} {obj_type_plural} in the house.",
    ],
    CType.AT_LEAST_N_COLOR_OBJECTS: [
        "There must be at least {n} {color} {object_word} in the house.",
    ],
    CType.AT_LEAST_N_STYLE_OBJECTS: [
        "There must be at least {n} {style} {object_word} in the house.",
    ],
    CType.NO_COLOR_OBJECTS_IN_HOUSE: [
        "There must not be any {color} objects in the house.",
    ],
    # Global qualitative
    CType.ALL_OBJECT_TYPE_SAME_COLOR: [
        "All {obj_type_plural} in the house must be {color}.",
    ],
    CType.ALL_OBJECT_TYPE_SAME_STYLE: [
        "All {obj_type_plural} in the house must be {style}.",
    ],
    # Relational
    CType.COLOR_ROOM_COUNT_EQUAL: [
        "The number of {colorA} rooms must equal the number of {colorB} rooms.",
    ],
    CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE: [
        "Any room with a {obj_typeA_lower} must also contain a {obj_typeB_lower}.",
    ],
    CType.NO_ROOM_MORE_THAN_ONE_STYLE: [
        "No room may contain more than one {style} item.",
    ],
    # Temperature
    CType.AT_LEAST_N_WARM_OBJECTS: [
        "There must be at least {n} warm-colored {object_word} in the house.",
    ],
    CType.AT_LEAST_N_COOL_OBJECTS: [
        "There must be at least {n} cool-colored {object_word} in the house.",
    ],
}

# Voice prefixes paired with the grammatical form they expect:
#   "formal"     → subjunctive (remove "must"/"may", keep verb base form)
#   "casual"     → infinitive  (replace "must" with "to")
#   "passionate" → infinitive  (same transform as casual, stronger wording)
#   "neutral"    → no transform
VOICE_PREFIXES: dict[str, list[str]] = {
    "formal": [
        "It is essential that ",
        "I insist that ",
        "I require that ",
        "It is important that ",
    ],
    "casual": [
        "I'd really like ",
        "I'd love for ",
        "I want ",
        "I'd prefer for ",
    ],
    "passionate": [
        "I absolutely need ",
        "I really, really need ",
        "I desperately want ",
        "It's vital to me for ",
    ],
    "neutral": [""],
}


def _transform_for_voice(text: str, voice: str) -> str:
    """
    Transform a neutral-voice sentence for a specific voice style.

    All templates use 'must' / 'must not' / 'may' / 'may not', so we can
    reliably transform them:
      - formal    → subjunctive:  "must" → "", "must not" → "not"
      - casual    → infinitive:   "must" → "to", "must not" → "not to"
      - passionate → infinitive:  same as casual
    """
    # Strip period, lowercase first character
    core = text.rstrip(".")
    core = core[0].lower() + core[1:]

    if voice == "formal":
        # Subjunctive form: "the room must be" → "the room be"
        core = _re.sub(r"\bmust not\b", "not", core)
        core = _re.sub(r"\bmust\b", "", core)
        core = _re.sub(r"\bmay not\b", "not", core)
        core = _re.sub(r"\bmay\b", "", core)
        # Clean up double spaces left by removal
        core = _re.sub(r"  +", " ", core)
    else:
        # Infinitive form: "the room must be" → "the room to be"
        core = _re.sub(r"\bmust not\b", "not to", core)
        core = _re.sub(r"\bmust\b", "to", core)
        core = _re.sub(r"\bmay not\b", "not to", core)
        core = _re.sub(r"\bmay\b", "to", core)

    return core


def render_nl(c: Constraint, voice: str = "neutral") -> str:
    """Render a constraint as a natural language sentence with optional voice."""
    templates = NL_TEMPLATES.get(c.ctype)
    if not templates:
        return f"[{c.ctype.name}] {c.params}"

    template = random.choice(templates)

    # Build substitution dictionary
    subs: dict[str, str] = {}
    p = c.params

    # Copy all direct params
    for k, v in p.items():
        subs[k] = str(v)

    # Derived substitutions
    if "obj_type" in p:
        subs["obj_type_lower"] = p["obj_type"].lower()
        subs["obj_type_plural"] = OBJECT_TYPE_PLURAL[p["obj_type"]]
    if "obj_typeA" in p:
        subs["obj_typeA_lower"] = p["obj_typeA"].lower()
    if "obj_typeB" in p:
        subs["obj_typeB_lower"] = p["obj_typeB"].lower()
    if "style" in p:
        subs["style"] = p["style"].lower()
    if "n" in p:
        n = p["n"]
        subs["n"] = str(n)
        subs["room_word"] = "room" if n == 1 else "rooms"
        subs["object_word"] = "object" if n == 1 else "objects"

    text = template.format(**subs)

    # Apply voice
    if voice != "neutral" and voice in VOICE_PREFIXES:
        prefix = random.choice(VOICE_PREFIXES[voice])
        if prefix:
            core = _transform_for_voice(text, voice)
            text = prefix + core + "."

    return text


# ════════════════════════════════════════════════════════════════
# SECTION 6: FINAL STATE GENERATION
# ════════════════════════════════════════════════════════════════

def generate_final_state(
    num_players: int,
    difficulty: str = "medium",
    seed: Optional[int] = None,
) -> HouseState:
    """
    Generate a plausible final board state for a Decorum scenario.

    The algorithm:
      1. Picks a color/style palette based on difficulty
      2. Assigns wall colors with variety
      3. Places objects with optional pattern biasing (color-matching,
         style uniformity) to create structure for interesting constraints
      4. Applies sanity checks (variety, coverage)
    """
    if seed is not None:
        random.seed(seed)

    params = DIFFICULTY_PARAMS.get(difficulty, DIFFICULTY_PARAMS["medium"])
    room_names = ROOMS_2P if num_players == 2 else ROOMS_34P

    state = HouseState(num_players)

    # ── 1. Sample palette ──────────────────────────────────────
    num_colors = min(params["num_colors"], len(COLORS))
    num_styles = min(params["num_styles"], len(STYLES))
    colors_used = random.sample(COLORS, num_colors)
    styles_used = random.sample(STYLES, num_styles)

    # ── 2. Assign wall colors (ensure >= 2 distinct) ──────────
    for attempt in range(100):
        wall_colors = [random.choice(colors_used) for _ in room_names]
        if len(set(wall_colors)) >= 2:
            break
    for rn, wc in zip(room_names, wall_colors):
        state.rooms[rn].wall_color = wc

    # ── 3. Place objects with pattern biasing ──────────────────
    min_items, max_items = params["total_items_range"]
    target_items = random.randint(min_items, max_items)
    pattern_prob = params["pattern_prob"]

    # Generate all possible slot placements, shuffle for randomness
    all_slots = [(rn, ot) for rn in room_names for ot in OBJECT_TYPES]
    random.shuffle(all_slots)

    # Optionally pick a "theme style" for one object type (creates ALL_SAME patterns)
    theme_obj_type = random.choice(OBJECT_TYPES) if random.random() < 0.4 else None
    theme_style = random.choice(styles_used) if theme_obj_type else None

    placed = 0
    for rn, ot in all_slots:
        if placed >= target_items:
            break

        style = random.choice(styles_used)

        # Pattern biasing
        if theme_obj_type and ot == theme_obj_type and random.random() < 0.7:
            # Use the theme style for this object type
            style = theme_style

        elif random.random() < pattern_prob:
            # Try to match object color to wall color
            wall_col = state.rooms[rn].wall_color
            if wall_col in COLOR_TO_STYLE.get(ot, {}):
                candidate_style = COLOR_TO_STYLE[ot][wall_col]
                if candidate_style in styles_used:
                    style = candidate_style

        token = ObjectToken(obj_type=ot, style=style)
        state.rooms[rn].set_object(ot, token)
        placed += 1

    # ── 4. Sanity checks ──────────────────────────────────────
    _ensure_object_type_coverage(state, room_names, styles_used)
    _ensure_style_variety(state, room_names, styles_used)

    return state


def _ensure_object_type_coverage(
    state: HouseState, room_names: list[str], styles_used: list[str]
):
    """Ensure at least one of each object type exists in the house."""
    for ot in OBJECT_TYPES:
        if state.count_objects_of_type(ot) == 0:
            empty_rooms = [rn for rn in room_names
                           if state.rooms[rn].get_object(ot) is None]
            if empty_rooms:
                rn = random.choice(empty_rooms)
                style = random.choice(styles_used)
                state.rooms[rn].set_object(ot, ObjectToken(obj_type=ot, style=style))


def _ensure_style_variety(
    state: HouseState, room_names: list[str], styles_used: list[str]
):
    """Ensure at least 2 distinct styles are present among all objects."""
    all_styles = {obj.style for obj in state.get_all_objects()}
    if len(all_styles) < 2 and len(styles_used) >= 2:
        # Pick a random object and change its style
        for rn in room_names:
            for ot in OBJECT_TYPES:
                obj = state.rooms[rn].get_object(ot)
                if obj and obj.style in all_styles:
                    other_styles = [s for s in styles_used if s != obj.style]
                    if other_styles:
                        new_style = random.choice(other_styles)
                        state.rooms[rn].set_object(
                            ot, ObjectToken(obj_type=ot, style=new_style)
                        )
                        return


# ════════════════════════════════════════════════════════════════
# SECTION 7: CONSTRAINT ASSIGNMENT
# ════════════════════════════════════════════════════════════════

def assign_constraints(
    state: HouseState,
    num_players: int,
    rules_per_player: int = 4,
    seed: Optional[int] = None,
) -> dict[int, list[Constraint]]:
    """
    Assign constraints to each player from the candidate pool.

    All constraints are guaranteed satisfied by `state` (by construction).
    The algorithm uses weighted random selection with diversity heuristics:
      - Each player should reference at least 2 distinct "targets" (rooms/areas)
      - Constraint type variety per player
      - No duplicate constraints across players
    """
    if seed is not None:
        random.seed(seed)

    # Generate candidates
    all_cands = generate_candidates(state)

    # Deduplicate (keep highest score if duplicates exist)
    cand_map: dict = {}
    for c in all_cands:
        key = c._key
        if key not in cand_map or c.score > cand_map[key].score:
            cand_map[key] = c
    candidates = list(cand_map.values())

    # Shuffle to break ties
    random.shuffle(candidates)
    # Sort by score descending (stable sort preserves shuffle order for ties)
    candidates.sort(key=lambda c: c.score, reverse=True)

    assignments: dict[int, list[Constraint]] = {p: [] for p in range(num_players)}
    used_keys: set = set()

    # Per-player tracking for diversity
    player_rooms: dict[int, set[str]] = {p: set() for p in range(num_players)}
    player_ctypes: dict[int, set[CType]] = {p: set() for p in range(num_players)}
    player_has_positive: dict[int, bool] = {p: False for p in range(num_players)}
    player_has_negative: dict[int, bool] = {p: False for p in range(num_players)}

    # Classify constraints as positive/negative
    NEGATIVE_TYPES = {
        CType.ROOM_WALL_COLOR_IS_NOT, CType.ROOM_NO_OBJECT_TYPE,
        CType.ROOM_NO_STYLE, CType.ROOM_NO_COLOR_OBJECT,
        CType.AREA_NO_OBJECT_TYPE, CType.AREA_NO_COLOR_OBJECT,
        CType.AREA_NO_STYLE, CType.NO_COLOR_OBJECTS_IN_HOUSE,
    }

    def get_referenced_rooms(c: Constraint) -> set[str]:
        rooms: set[str] = set()
        if "room" in c.params:
            rooms.add(c.params["room"])
        if "area" in c.params:
            rooms.update(state.layout.get(c.params["area"], []))
        return rooms

    def compatibility_score(c: Constraint, player: int) -> float:
        """Score how well this constraint fits the player's current set."""
        sc = c.score
        refs = get_referenced_rooms(c)
        is_neg = c.ctype in NEGATIVE_TYPES

        # Bonus for referencing new rooms (diversity)
        new_rooms = refs - player_rooms[player]
        if new_rooms:
            sc += 1.5

        # Bonus for type diversity
        if c.ctype not in player_ctypes[player]:
            sc += 1.0

        # Bonus for mixing positive/negative
        if is_neg and not player_has_negative[player]:
            sc += 1.0
        elif not is_neg and not player_has_positive[player]:
            sc += 1.0

        # Penalty if all refs overlap with existing (too focused on one room)
        if refs and not new_rooms and len(player_rooms[player]) >= 2:
            sc -= 2.0

        # Penalty for same ctype as existing
        if c.ctype in player_ctypes[player]:
            sc -= 1.5

        return max(sc, 0.1)

    # Iterative assignment: round-robin across players
    for round_idx in range(rules_per_player):
        for player in range(num_players):
            if len(assignments[player]) >= rules_per_player:
                continue

            # Filter available candidates
            eligible = [c for c in candidates if c._key not in used_keys]
            if not eligible:
                break

            # Score each candidate for this player
            scored = [(c, compatibility_score(c, player)) for c in eligible]

            # Weighted random selection
            total_weight = sum(s for _, s in scored)
            if total_weight <= 0:
                break

            r = random.uniform(0, total_weight)
            cumulative = 0.0
            chosen = scored[0][0]
            for c, s in scored:
                cumulative += s
                if cumulative >= r:
                    chosen = c
                    break

            # Assign
            assignments[player].append(chosen)
            used_keys.add(chosen._key)

            # Update tracking
            player_rooms[player].update(get_referenced_rooms(chosen))
            player_ctypes[player].add(chosen.ctype)
            if chosen.ctype in NEGATIVE_TYPES:
                player_has_negative[player] = True
            else:
                player_has_positive[player] = True

    return assignments


# ════════════════════════════════════════════════════════════════
# SECTION 8: INITIAL BOARD GENERATION (Backward Walk)
# ════════════════════════════════════════════════════════════════

@dataclass(frozen=True)
class Move:
    """
    A single legal game action applied during backward-walk perturbation.

    Fields used per action type:
      paint:  room_name, old_color, new_color
      swap:   room_name, obj_type, old_style, new_style
      remove: room_name, obj_type, old_style
      add:    room_name, obj_type, new_style
    """
    action: str
    room_name: str
    obj_type: str = ""
    old_style: str = ""
    new_style: str = ""
    old_color: str = ""
    new_color: str = ""

    @property
    def inverse(self) -> "Move":
        """The move that exactly undoes this one."""
        if self.action == "paint":
            return Move("paint", self.room_name,
                        old_color=self.new_color, new_color=self.old_color)
        if self.action == "swap":
            return Move("swap", self.room_name, self.obj_type,
                        old_style=self.new_style, new_style=self.old_style)
        if self.action == "remove":
            return Move("add", self.room_name, self.obj_type,
                        new_style=self.old_style)
        if self.action == "add":
            return Move("remove", self.room_name, self.obj_type,
                        old_style=self.new_style)
        raise ValueError(f"Unknown action: {self.action}")

    def describe(self) -> str:
        """Human-readable description of this move."""
        if self.action == "paint":
            return f"Paint {self.room_name}: {self.old_color} -> {self.new_color}"
        if self.action == "swap":
            ot = self.obj_type
            old_col = STYLE_TO_COLOR[ot][self.old_style]
            new_col = STYLE_TO_COLOR[ot][self.new_style]
            return (f"Swap {self.old_style} {old_col} {ot} -> "
                    f"{self.new_style} {new_col} {ot} in {self.room_name}")
        if self.action == "remove":
            col = STYLE_TO_COLOR[self.obj_type][self.old_style]
            return f"Remove {self.old_style} {col} {self.obj_type} from {self.room_name}"
        if self.action == "add":
            col = STYLE_TO_COLOR[self.obj_type][self.new_style]
            return f"Add {self.new_style} {col} {self.obj_type} to {self.room_name}"
        return str(self)


@dataclass
class PerturbationConfig:
    """
    User-configurable parameters for initial board generation.

    All fields have sensible defaults; override any subset as needed.
    Example:
        config = PerturbationConfig(num_perturbations=10, min_violations_per_player=2)
    """
    num_perturbations: int = 6
    min_violations_per_player: int = 1
    allowed_types: tuple = ("paint", "swap", "remove", "add")
    type_weights: dict = field(default_factory=lambda: {
        "paint": 1.0, "swap": 1.5, "remove": 0.8, "add": 0.3,
    })
    max_attempts: int = 30  # retry the whole walk if violations insufficient

    @classmethod
    def from_difficulty(cls, difficulty: str) -> "PerturbationConfig":
        """Create a config from a difficulty preset."""
        params = DIFFICULTY_PARAMS.get(difficulty, DIFFICULTY_PARAMS["medium"])
        lo, hi = params["num_perturbations_range"]
        return cls(
            num_perturbations=random.randint(lo, hi),
            type_weights=dict(params["perturbation_weights"]),
        )


def _list_all_moves(state: HouseState, allowed_types: tuple) -> list[Move]:
    """Enumerate every legal move from the current state."""
    moves: list[Move] = []
    for rn in state.room_names:
        room = state.rooms[rn]

        # Paint wall to a different color
        if "paint" in allowed_types:
            for color in COLORS:
                if color != room.wall_color:
                    moves.append(Move("paint", rn,
                                      old_color=room.wall_color, new_color=color))

        # Swap existing object to a different style
        if "swap" in allowed_types:
            for ot in OBJECT_TYPES:
                obj = room.get_object(ot)
                if obj is not None:
                    for style in STYLES:
                        if style != obj.style:
                            moves.append(Move("swap", rn, ot,
                                              old_style=obj.style, new_style=style))

        # Remove an existing object
        if "remove" in allowed_types:
            for ot in OBJECT_TYPES:
                obj = room.get_object(ot)
                if obj is not None:
                    moves.append(Move("remove", rn, ot, old_style=obj.style))

        # Add an object to an empty slot
        if "add" in allowed_types:
            for ot in OBJECT_TYPES:
                if room.get_object(ot) is None:
                    for style in STYLES:
                        moves.append(Move("add", rn, ot, new_style=style))

    return moves


def _apply_move_inplace(state: HouseState, move: Move) -> None:
    """Apply a move to the state in-place."""
    if move.action == "paint":
        state.paint_room(move.room_name, move.new_color)
    elif move.action == "swap":
        token = ObjectToken(obj_type=move.obj_type, style=move.new_style)
        state.swap_object(move.room_name, token)
    elif move.action == "remove":
        state.remove_object(move.room_name, move.obj_type)
    elif move.action == "add":
        token = ObjectToken(obj_type=move.obj_type, style=move.new_style)
        state.add_object(move.room_name, token)


def _pick_random_move(
    state: HouseState,
    config: PerturbationConfig,
    visited: set[tuple],
    last_move: Optional[Move],
) -> Optional[tuple[Move, tuple]]:
    """
    Pick a random valid move using weighted selection.

    Rejects moves that:
      - Are the exact inverse of the last move (immediate undo)
      - Lead to a previously visited state (cycle)

    Returns (move, new_fingerprint) or None if no valid move exists.
    """
    candidates = _list_all_moves(state, config.allowed_types)

    # Build weighted list and shuffle for tie-breaking
    weighted: list[tuple[Move, float]] = [
        (m, config.type_weights.get(m.action, 1.0)) for m in candidates
    ]
    random.shuffle(weighted)

    while weighted:
        # Weighted random selection
        total = sum(w for _, w in weighted)
        if total <= 0:
            return None

        r = random.uniform(0, total)
        cumulative = 0.0
        idx = 0
        for i, (_, w) in enumerate(weighted):
            cumulative += w
            if cumulative >= r:
                idx = i
                break

        move, _ = weighted.pop(idx)

        # Reject immediate undo
        if last_move is not None and move == last_move.inverse:
            continue

        # Tentatively apply, check for cycle, then revert
        _apply_move_inplace(state, move)
        fp = state.fingerprint()

        if fp in visited:
            _apply_move_inplace(state, move.inverse)
            continue

        # Valid — revert so the caller can apply officially
        _apply_move_inplace(state, move.inverse)
        return move, fp

    return None  # no valid move found


def _count_violations(
    state: HouseState, assignments: dict[int, list[Constraint]]
) -> dict[int, int]:
    """Count how many constraints each player has violated."""
    return {
        p: sum(1 for r in rules if not r.evaluate(state))
        for p, rules in assignments.items()
    }


def _all_meet_min(violations: dict[int, int], minimum: int) -> bool:
    """Check if every player has at least `minimum` violations."""
    return all(v >= minimum for v in violations.values())


def _targeted_violation_fix(
    state: HouseState,
    assignments: dict[int, list[Constraint]],
    min_violations: int,
    visited: set[tuple],
    moves: list[Move],
    allowed_types: tuple,
    max_extra_moves: int = 10,
) -> None:
    """
    After the random walk, make additional targeted moves to ensure
    each player has at least `min_violations` constraints violated.

    Modifies `state`, `visited`, and `moves` in-place.
    """
    extra = 0
    for _ in range(max_extra_moves):
        violations = _count_violations(state, assignments)
        if _all_meet_min(violations, min_violations):
            return

        # Find an under-violated player
        under = [p for p, v in violations.items() if v < min_violations]
        if not under:
            return
        player = random.choice(under)

        # Pick a satisfied constraint of that player to try to break
        satisfied = [r for r in assignments[player] if r.evaluate(state)]
        random.shuffle(satisfied)

        for target in satisfied:
            candidates = _list_all_moves(state, allowed_types)
            random.shuffle(candidates)

            found = False
            for move in candidates:
                # Skip immediate undo of last move
                if moves and move == moves[-1].inverse:
                    continue

                _apply_move_inplace(state, move)
                fp = state.fingerprint()

                if fp not in visited and not target.evaluate(state):
                    # This move breaks the target constraint — accept it
                    visited.add(fp)
                    moves.append(move)
                    extra += 1
                    found = True
                    break
                else:
                    _apply_move_inplace(state, move.inverse)

            if found:
                break  # re-evaluate all players from the top


def generate_initial_state(
    solution: HouseState,
    assignments: dict[int, list[Constraint]],
    config: Optional[PerturbationConfig] = None,
    seed: Optional[int] = None,
) -> tuple[HouseState, list[Move]]:
    """
    Generate an initial board state by backward-walking from the solution.

    The algorithm:
      1. Phase 1 — Random walk: apply N random legal moves from the solution,
         avoiding immediate undos and graph-theoretic cycles (revisiting states).
      2. Phase 2 — Targeted fix: if any player has fewer than
         `min_violations_per_player` constraints violated, make additional
         targeted moves to break at least one of their satisfied constraints.
      3. Retry: if the result doesn't meet the violation requirement,
         retry the whole process up to `max_attempts` times, keeping the best.

    Returns (initial_state, list_of_moves_applied).
    """
    if seed is not None:
        random.seed(seed)
    if config is None:
        config = PerturbationConfig()

    best_state: Optional[HouseState] = None
    best_moves: Optional[list[Move]] = None
    best_score = -1  # number of players meeting min_violations

    for attempt in range(config.max_attempts):
        state = solution.deep_copy()
        visited: set[tuple] = {state.fingerprint()}
        moves_applied: list[Move] = []
        last_move: Optional[Move] = None

        # ── Phase 1: Random walk ───────────────────────────────
        for step in range(config.num_perturbations):
            result = _pick_random_move(state, config, visited, last_move)
            if result is None:
                break  # stuck, no valid moves left
            move, fp = result
            _apply_move_inplace(state, move)
            visited.add(fp)
            moves_applied.append(move)
            last_move = move

        # ── Phase 2: Targeted violation fix ────────────────────
        _targeted_violation_fix(
            state, assignments, config.min_violations_per_player,
            visited, moves_applied, config.allowed_types,
        )

        # ── Score this attempt ─────────────────────────────────
        violations = _count_violations(state, assignments)
        score = sum(1 for v in violations.values()
                    if v >= config.min_violations_per_player)

        if score > best_score:
            best_state = state
            best_moves = list(moves_applied)
            best_score = score

        if score == len(assignments):
            break  # all players meet the minimum — done

    return best_state, best_moves  # type: ignore[return-value]


# ════════════════════════════════════════════════════════════════
# SECTION 9: DISPLAY & MAIN
# ════════════════════════════════════════════════════════════════

PLAYER_NAMES = ["Alice", "Bob", "Carol", "Dave"]
PLAYER_VOICES = ["formal", "casual", "passionate", "neutral"]


def display_scenario(
    initial_state: HouseState,
    solution_state: HouseState,
    assignments: dict[int, list[Constraint]],
    moves: list[Move],
) -> None:
    """Display the complete generated scenario with both boards."""

    # ── Initial board (what players start with) ────────────────
    initial_state.display(label="INITIAL BOARD  (Setup - visible to all players)")

    # ── Solution board (hidden target) ─────────────────────────
    solution_state.display(label="SOLUTION BOARD  (Hidden - scenario designer only)")

    # ── Player conditions with violation status ────────────────
    print()
    print("=" * 70)
    print("  PLAYER CONDITIONS")
    print("=" * 70)

    for player, rules in assignments.items():
        name = PLAYER_NAMES[player % len(PLAYER_NAMES)]
        voice = PLAYER_VOICES[player % len(PLAYER_VOICES)]
        violated = sum(1 for r in rules if not r.evaluate(initial_state))
        print(f"\n  Player {player + 1} - {name} (voice: {voice})"
              f"  [{violated}/{len(rules)} violated on initial board]")
        print(f"  {'-' * 60}")
        for i, rule in enumerate(rules, 1):
            nl = rule.to_nl(voice)
            on_initial = rule.evaluate(initial_state)
            on_solution = rule.evaluate(solution_state)
            status = "OK" if on_initial else "VIOLATED"
            print(f"    {i}. {nl}  [{status}]")
            if not on_solution:
                print(f"       *** BUG: also violated on solution! ***")

    # ── Perturbation log ───────────────────────────────────────
    print()
    print("=" * 70)
    print(f"  PERTURBATION LOG  ({len(moves)} moves from solution -> initial)")
    print("=" * 70)
    for i, move in enumerate(moves, 1):
        print(f"    {i}. {move.describe()}")
    if not moves:
        print("    (no perturbations applied)")

    # ── Verification ───────────────────────────────────────────
    print()
    print("=" * 70)
    print("  VERIFICATION")
    print("=" * 70)
    # Check solution satisfies all constraints
    all_ok = True
    total_constraints = 0
    for player, rules in assignments.items():
        for rule in rules:
            total_constraints += 1
            if not rule.evaluate(solution_state):
                print(f"  FAIL on solution: Player {player + 1}: {rule}")
                all_ok = False
    if all_ok:
        print(f"  All {total_constraints} constraints satisfied by solution. OK")

    # Check every player has at least 1 violation on initial
    violations = _count_violations(initial_state, assignments)
    all_violated = all(v >= 1 for v in violations.values())
    viol_str = ", ".join(f"P{p+1}={v}" for p, v in violations.items())
    print(f"  Violations on initial board: {viol_str}"
          + ("  OK" if all_violated else "  WARNING: some players start fulfilled!"))

    # ── Statistics ─────────────────────────────────────────────
    print()
    print("=" * 70)
    print("  STATISTICS")
    print("=" * 70)
    print(f"  Solution objects: {len(solution_state.get_all_objects())}")
    print(f"  Initial objects:  {len(initial_state.get_all_objects())}")
    print(f"  Perturbation moves: {len(moves)}")
    sol_walls = [solution_state.rooms[rn].wall_color for rn in solution_state.room_names]
    ini_walls = [initial_state.rooms[rn].wall_color for rn in initial_state.room_names]
    print(f"  Solution wall colors: {sol_walls}")
    print(f"  Initial wall colors:  {ini_walls}")
    print(f"  Constraints per player: {[len(r) for r in assignments.values()]}")

    # Constraint type distribution
    type_counts: dict[str, int] = {}
    for rules in assignments.values():
        for rule in rules:
            tname = rule.ctype.name
            type_counts[tname] = type_counts.get(tname, 0) + 1
    print(f"  Constraint types: {type_counts}")


def main():
    """CLI entry point: interactive or argument-driven."""
    print()
    print("=" * 70)
    print("  DECORUM SCENARIO GENERATOR - Prototype")
    print("=" * 70)
    print()

    # Parse arguments or interactive input
    if len(sys.argv) > 1:
        num_players = int(sys.argv[1])
        difficulty = sys.argv[2] if len(sys.argv) > 2 else "medium"
        seed = int(sys.argv[3]) if len(sys.argv) > 3 else None
    else:
        # Interactive mode
        while True:
            try:
                num_players = int(input("  Number of players (2-4): "))
                if 2 <= num_players <= 4:
                    break
                print("  Please enter 2, 3, or 4.")
            except ValueError:
                print("  Please enter a valid number.")

        difficulty = (
            input("  Difficulty (easy/medium/hard) [medium]: ").strip().lower()
            or "medium"
        )
        if difficulty not in DIFFICULTY_PARAMS:
            print(f"  Unknown difficulty '{difficulty}', using 'medium'.")
            difficulty = "medium"

        seed_input = input("  Random seed (blank for random): ").strip()
        seed = int(seed_input) if seed_input else None

    # Validate
    if not (2 <= num_players <= 4):
        print(f"  Error: num_players must be 2-4, got {num_players}")
        sys.exit(1)
    if difficulty not in DIFFICULTY_PARAMS:
        difficulty = "medium"

    params = DIFFICULTY_PARAMS[difficulty]
    rules_per_player = params["rules_per_player"]

    # Build perturbation config from difficulty (user can override any field)
    perturb_config = PerturbationConfig.from_difficulty(difficulty)

    print()
    print(f"  Generating scenario: {num_players} players, {difficulty} difficulty, "
          f"{rules_per_player} rules/player, "
          f"{perturb_config.num_perturbations} perturbations"
          + (f", seed={seed}" if seed is not None else ""))
    print()

    # Step 1: Generate solution (final state)
    solution = generate_final_state(num_players, difficulty, seed)

    # Step 2: Assign constraints (all true on solution)
    assignments = assign_constraints(solution, num_players, rules_per_player, seed)

    # Step 3: Generate initial board by backward walk from solution
    initial, moves = generate_initial_state(
        solution, assignments, config=perturb_config,
        seed=(seed * 3 + 7) if seed is not None else None,
    )

    # Display complete scenario
    display_scenario(initial, solution, assignments, moves)


if __name__ == "__main__":
    main()
