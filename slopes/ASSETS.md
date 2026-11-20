# Art assets

All art is **placeholder pixel art** in `public/assets/`, drawn by `tools/make-placeholder-art.mjs` (`npm run art`) from the looks in `src/data/characters.json`. The game loads everything through `public/assets/manifest.json`, so you can replace any image with your own PNG.

**To replace an image:** save your PNG over the old one with the **same file name and the same layout** (frame size and order below). The game scales up with nearest-neighbour, so keep it pixel art at the same size. Then **stop running `npm run art`**, because it overwrites every PNG. Keep your originals somewhere else too.

## Skiers: `sprites/<id>.png`

One sheet per person: **24x32 px frames, 10 frames in one row (240x32 px)**. The feet sit near the bottom centre of each frame (2px up from the bottom).

| Frame | Pose |
|---|---|
| 0 | Straight down the hill, facing the camera |
| 1 | Turning slightly right |
| 2 | Diagonal right |
| 3 | Side on, facing right (traversing or stopped) |
| 4 | Crashed in the snow, skis everywhere |
| 5 | Jumping, arms out |
| 6 | Tuck |
| 7 | Standing, poles planted |
| 8 | Shouting / waving, one arm up |
| 9 | Sitting in the snow |

Left-facing poses are the right-facing ones mirrored by the game.

Ids: `andy`; the lads `steve`, `jimmy`, `plug`, `kft`, `sid`, `rocker`; `lee`, `alistair`, `bob` (Banter Bob), `mireille` (the ski instructor); ski school kids `kid1`, `kid2`, `kid3`; `boarder`; tourists `tourist1`, `tourist2`, `tourist3`.

Andy also has `andy_angry.png` (used at 55%+ anger) and `andy_furious.png` (75%+), in the same layout.

## Portraits: `portraits/*.png`

**32x32 px** head-and-shoulders, shown in the HUD, on scrape cards and on messages.

- `andy_neutral`, `andy_annoyed`, `andy_irritated`, `andy_angry`, `andy_furious`, `andy_shouting`: the anger meter faces, lowest to highest.
- One for each of the lads, `lee`, `alistair`, `bob`, `mireille`, plus `chairman` (on the phone).

## Objects: `sprites/objects.png`

Everything else, packed in one row. Each frame's position and size are in `manifest.json` under `objects.frames`; if you change sizes, edit those numbers. Objects are drawn with their bottom centre on the snow.

`tree`, `tree_small`, `tree_big`, `rock`, `stump`, `mogul`, `ramp`, `flag_red`, `flag_blue` (slalom gates), `pylon` (chairlift), `cannon` (snow cannon), `hut`, `cocoa` (the hot chocolate stand), `sign_green`, `sign_blue`, `sign_red`, `sign_black`, `ice`, `snowball`, `chair` (chairlift chair), the scrape items `ski`, `pass`, `suncream`, `deepheat`, `map`, `tape`, plus `speaker`, `goggles_item`, `basher` (piste basher), `fence`, `yard` (a pile of dropped kit), `snowman`, `powder`, `marker` (piste edge pole), `bar` (the bar at the bottom; the game writes its name on the sign), `zzz`, `phone` and `marmot`.

## Fonts and sound

Text uses the Google Fonts *Press Start 2P* and *VT323*, falling back to monospace when offline. Sound effects are synthesised in `src/core/audio.ts`.
