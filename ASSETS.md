# Art assets

All art is **placeholder pixel art** in `public/assets/`, drawn by `tools/make-placeholder-art.mjs` (`npm run art`). The game loads everything through `public/assets/manifest.json`, so you can replace any image with your own PNG.

**To replace an image:** save your PNG over the old one with the **same file name and the same layout** (frame size and order below). The game scales up with nearest-neighbour, so keep it pixel art at the same size. Then **stop running `npm run art`**, because it overwrites every PNG. Keep your originals somewhere else too.

To use a different frame size or layout, change the numbers in `manifest.json` to match.

## Characters: `sprites/<id>.png`

One sheet per person: **16x24 px frames, 3 columns x 6 rows (48x144 px)**. The feet sit at the bottom centre of each frame.

| Row | Animation | Frames (left to right) |
|---|---|---|
| 0 | Walk down (facing camera) | stand, step A, step B |
| 1 | Walk up (back to camera) | stand, step A, step B |
| 2 | Walk left | stand, step A, step B |
| 3 | Walk right | stand, step A, step B |
| 4 | Work: sat at a desk, seen from behind, typing | 3 frames |
| 5 | Shout / rant / laugh (facing camera) | point, mouth open, arm raised |

Ids: `andy`; staff `sharon`, `bev`, `gaz`; regulars `tina`, `len`, `gary`, `barry`, `brian`, `carol`, `jan`; troublemakers `kyle`, `tyler`, `jayden`, `steve`; members `pat`, `phil`, `jo`, `darren`, `priya`, `pemberton`, `alfie`; visitors `lee`, `alistair`.

Andy also has `andy_angry.png` (used at 50%+ anger) and `andy_furious.png` (80%+), in the same layout.

## Portraits: `portraits/*.png`

**32x32 px** head-and-shoulders, shown in the HUD and on task cards. Any square size works; it is scaled.

- `andy_neutral`, `andy_annoyed`, `andy_irritated`, `andy_angry`, `andy_furious`, `andy_shouting`: the anger meter faces, lowest to highest.
- One per character id above, plus `manager` (the Area Manager) and `coldcaller` (the face on sales calls).

## Tiles: `tiles/tiles.png`

A single row of **16x16 px** tiles, in this order: `wall_top`, `wall_front`, `door`, `carpet_blue` (Finance), `carpet_grey` (Middle Office), `carpet_green` (IT), `lino` (kitchen and corridor), `tile_blue` (shower), `tile_white` (toilet), `server`, `stairs`, `pavement`, `bay`, `road`, `grass`, `tarmac`, `water` (pool), `lane` (bowling), `gym_mat`, `wood` (cafe), `carpet_red` (bowling alley). Not every tile is used.

## Objects: `sprites/objects.png`

Furniture packed in one row. Each frame's position and size, and its draw offset `ox`/`oy` from its tile's top-left, are in `manifest.json` under `objects.frames`. If you change sizes, edit those numbers.

`desk` (32x24, 2 tiles wide, monitor screen at x10-21, y1-8), the monitor screens `screen_off`, `screen_work`, `screen_game`, `screen_football` and `screen_call`, `screen_error` (12x8 each, drawn over the desk monitor), `rack`, `counter`, `kettle`, `fridge`, `toilet`, `sink`, `shower` (32x32), `printer`, `cooler`, `plant`, `filing`, `beanbag`, `bin`, `whiteboard`, `dartboard` (16x16, hung on the IT Office's top wall), `dart` (3x7, used for the throws), `deskphone` (10x8, sits on Andy's desk and shakes when it rings), `callscreen` (24x14 wall TV in the IT Office; the game writes CALLS and the number on it), `mess`, `out_of_order`, `stairs_up`, then the leisure centre pieces: `treadmill`, `bench`, `weights`, `mirror`, `lockers`, `bench_wood`, `coffee_machine`, `till`, `cakes`, `cafe_counter`, `desk_front`, `reception_pc`, `cafe_table`, `vending`, `turnstile`, `leaflets`, `ball_rack`, `pins`, `scoreboard`, `lifeguard_chair`, `lounger`, `sign_pool`, `noticeboard`, and the spills `puddle`, `sick`, `litter`.

## UI icons: `ui/icons.png`

A single row of **16x16 px** icons: `car`, `toilet`, `rant`, `fun`, `video`, `boss`, `shower`, `tea`, `bladder`, `check`, `cross`, `clock`, `warning`, `sound_on`, `sound_off`, `star`, `invoice`, `darts`, `window`, `phone`, `mobile`, `walk`, `screen`, `ai`, `jam`, `fix`, `thief`, `card`, `complaint`, `whistle`, `mop`, `pins`, `coin`.

## Fonts and sound

Text uses the Google Fonts *Press Start 2P* and *VT323*, falling back to monospace when offline. Sound effects are synthesised in `src/core/audio.ts`. To use recorded sounds, change `play()` to play audio files instead.
