# Stonefish v5.5 testunit1 notes

Development-only invariant: v5.5 testunit1 is Stonefish v5 plus ARMX-preview, and nothing else.

ARMX-preview speed constraints:
- 3-ply base critic.
- 4-ply extension only on a very small forcing subset.
- hard candidate and node budgets.
- no full-width duplicate search of Stonefish v5.
- ARMX is advisory; Stonefish v5 remains the move-selection authority.
- intentionally conservative/incomplete so later ARMX releases have clear room to improve.
