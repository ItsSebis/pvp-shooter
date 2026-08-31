# Game Design Document

## Pitch
A 2D top-down PvP shooter, playable in the browser (installable as a PWA), built for
2–5 minute matches during school breaks. One joystick controls movement, aiming/firing
is automatic. Skill comes from positioning, dodging, weapon-class matchup reads, and
timing — not manual aim. Progression (money → weapon/stat upgrades) matters but is
capped so a high-level player can still lose to a well-played low-level one.

## Core loop
1. Join a match (2 players, or small FFA — start with 1v1).
2. Move with one joystick. Weapon auto-fires at the nearest valid target in range + line of sight.
3. Kill enemies / survive to collect money.
4. Spend money at on-map shop zones (no separate menu screen — walk into a shop icon) to upgrade.
5. Match ends on a score/time/last-standing condition (TBD by whoever builds the match-loop —
   default suggestion: first to N kills or a 5-minute timer, whichever comes first).
6. On death: respawn at a lower level (see Level Decay below), match continues or ends per mode.

## Controls
- One virtual joystick (left thumb zone) — movement only.
- One optional dash/dodge button (right thumb zone) — short cooldown, this is the main
  actively-timed skill input layered on top of auto-aim.
- No manual aim/fire control. This is deliberate — see "Why auto-aim is fine" below.

## Why auto-aim is fine (and how skill still exists)
Removing manual aim removes the *offensive* skill floor so the interface stays a single
joystick. Skill must then live in:
- **Dodging** — weapons fire real projectiles with travel time and spread, not hitscan.
  Strafing perpendicular to incoming fire measurably reduces damage taken, at any level.
- **Line of sight** — auto-fire requires a clear sightline to the target. Breaking LOS
  (ducking behind map obstacles) drops the weapon's target lock, forcing a
  re-acquisition delay. Use of cover is a real, learnable skill.
- **Reading tells** — high-reward weapons have a visible windup (see weapon table) that
  a player can react to and punish or evade, independent of their own level.
- **Dash timing** — the one manual action button. Used to close distance during an
  enemy's cooldown window, or escape a spin-up before it reaches full damage.

## Weapon classes
Every player starts on **Shooter**. On reaching a level threshold (exact level TBD in
build), the player chooses one class to specialize into. Each class has a built-in,
*exploitable* weakness — this is what keeps a low-level Shooter able to beat a
high-level Minigun if piloted well. This is a rock-paper-scissors-with-skill layer, not
a pure stat ladder.

| Class | Strength | Exploitable weakness |
|---|---|---|
| Shooter (starter) | Balanced, no special tell, safe baseline | None — this is the reference point other classes trade around |
| Sniper | High single-hit damage, damage scales up with distance, still hits hard up close | Long cooldown between shots = a hard vulnerability window. Visible charge/laser-dot tell before firing. Rush it during the cooldown. |
| Shotgun | Big burst damage at close range | Damage falls off a cliff past close range — kite it, don't let it close distance |
| Minigun | Sustained DPS, forgiving, low execution skill to use | Slow turn/tracking speed, spread widens the longer it fires continuously, heavy movement penalty while firing. Dodge diagonally — it can't track. Visible spin-up before reaching full RPM — juke out of range during it. |

Exact numbers (damage, cooldowns, spread values, spin-up duration) are tuning
parameters, not fixed here — expect to iterate via playtesting with the actual friend
group. Keep them in a single shared config file both client and any authoritative
server logic import from (see Architecture doc) so balancing never requires touching
gameplay code.

## Progression / leveling
- Money collected in-match (kills, pickups, or a survive-timer) spent at shop zones.
- Leveling a weapon should be a **recognizable, felt upgrade** without pure stat
  inflation. Preferred approach: 3–4 level tiers max, each roughly +8–12% on the
  weapon's stats, hard-capped — not unlimited stacking. If time allows, prefer
  **ability-variant upgrades** at higher tiers (e.g. Minigun gains slightly faster
  spin-up at max level) over just bigger numbers, since a variant is legible and
  interesting without being purely "stronger."
- Include a **"friendly mode" toggle** that normalizes everyone to level 1 for
  pure-skill matches — important for a friend group where someone will always have
  played more than the others.

## Level decay on death
On death, respawn at a lower level rather than resetting to 0, using a halving curve:

```
new_level = max(1, round(current_level / 2))
```

This matches the stated examples exactly (16 → 8, 4 → 2) and is proportionally equal
pain regardless of investment. Two open decisions for whoever implements this:
- **Rounding direction** at odd levels (5 → 2.5): round up (harsher) or down (friendlier).
- The `max(1, ...)` clamp is required so no one decays below level 1.

## Map / shop
- Shop is a physical zone on the map, not a separate menu — walking into it opens a
  small upgrade UI, keeps the player in the game world (matches "save space" requirement
  from original brief).
- Map should include obstacles deliberately placed to make line-of-sight breaking a
  real, usable tactic (see auto-aim section above) — this is not optional set dressing,
  it's a core balancing tool for the Minigun/Sniper matchup.

## Platform target
- Browser-first, installable as a PWA (Add to Home Screen on iOS Safari, manifest-based
  install on Android/desktop). No App Store, no Mac requirement, no review process.
- Target orientation: landscape. iOS PWAs cannot programmatically lock orientation —
  detect via `matchMedia('(orientation: portrait)')` and show a rotate-prompt overlay
  rather than attempting to force rotation.
- Full detail in `docs/ARCHITECTURE.md`.

## Non-goals for v1
- No manual aim control.
- No more than a couple of maps.
- No matchmaking/ranking system — this is a friend-group game, direct invite/join is enough.
- No native app build.
