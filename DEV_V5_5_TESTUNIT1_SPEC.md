# Stonefish v5.5 testunit1 specification

Development-only invariant: v5.5 testunit1 is Stonefish v5 plus ARMX-preview, and nothing else.

ARMX-preview is separate, fast, advisory, and intentionally limited. It uses a 3-ply base critic and may selectively extend one forcing line to a maximum of 4 ply. It must not duplicate Stonefish v5's full search, and it must operate under hard candidate/node limits so future ARMX versions have meaningful room to improve.
