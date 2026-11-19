---
title: Game health display
dependencies: pass
---

# Game health display — epics and stories

## Overview

Players can see fighters' health during combat and when watching a replay.
The first story adds a shared health display. The second uses it during replay.

## Epic List

### Epic 1: See fighters' health

**Dependencies:** No other epics. This epic uses the existing engine and interface.

## Epic 1: See fighters' health

Implementation order: Story 1.1 → Story 1.2.
The parser reads each story's dependency field to build the graph.

### Story 1.1: Show health during combat

As a player, I want to see a fighter's current and maximum HP so I can assess
their condition during combat.

**Dependencies:** только существующий движок и интерфейс; Story 1.2 для завершения этой story не требуется.

**Scope:** Build a shared health display and connect it to live combat.
Story 1.2 covers replays.

**Acceptance Criteria:**

**Given** a fighter with 75 current HP and 100 maximum HP,
**When** the player opens the combat screen,
**Then** the display next to the fighter shows `75/100`,
**And** the display updates automatically when the fighter's health changes.

The parser ignores example fields inside fenced code blocks:

```markdown
**Dependencies:** Story 9.9
```

### Story 1.2: Show health during a replay

As a spectator, I want to see each fighter's recorded health during a replay so
I can follow the same changes that occurred in the original fight.

**Dependencies:** Story 1.1; будущих stories нет.

**Scope:** Record health changes and show them through the shared display.

**Acceptance Criteria:**

**Given** a recording in which a fighter's health drops from 75 to 60,
**When** playback reaches that action,
**Then** the shared display shows `60/100`,
**And** playback reads the value from the recording without simulating the fight again.
