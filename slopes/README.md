# Angry Andy on the Slopes

The fourth Angry Andy game, after *Angry Andy Gets The Gig*, *Model Leisure Centre* and *Football Coach*. Andy has gone on a ski week in the Alps with the lads: **Kinky Steve, Jimmy Ginge, Plug, KFT, Sid and the Aging Rocker**. He is still permanently annoyed. Get him down six runs (Monday to Saturday) without his anger hitting 100%.

Same pixel-art style, fonts, sounds and HUD as the earlier games, but this one is a downhill skiing game: the mountain scrolls up past Andy as he skis down it.

## How it plays

Steer Andy down the piste to the bar at the bottom. Trees, rocks, stumps, snowmen, snow cannons, chairlift pylons, piste bashers, ski school crocodiles, snowboarders sat in the middle of the piste and dawdling tourists all knock him over, and every crash winds him up. Jump the rocks and stumps, hit the ramps for big air, ride the moguls, and watch out for ice (you can hardly steer on it).

Meanwhile the lads get into **scrapes**. Each one pops up on the panel on the right (with how far down the hill it is), and an arrow at the edge of the screen points the way. Ski up to them and **hold SPACE** to sort it out: Andy calms down a bit and scores points. Ski past, or let the timer run out, and his anger goes up.

- **Kinky Steve** has stripped to his pants for a selfie at minus twelve, is chatting up the ski instructor, or his leopard-print onesie zip has gone (grab the gaffer tape).
- **Jimmy Ginge** is pelting you with snowballs (catch him), has burnt to a crisp (grab the suncream), or his goggles have steamed up and he's hugging a tree.
- **Plug** has fallen over (again), is doing a snowplough across the whole piste, or has lost a ski that's sliding off down the mountain on its own (chase it).
- **KFT** knows a shortcut through the trees, has dropped the only piste map, or is off for a schnapps at ten in the morning (catch him).
- **Sid** is asleep on the chairlift (get under his chair and shout), has lost his lift pass, or has sat down for a nap in the middle of the piste.
- **The Aging Rocker** is doing air guitar on skis all over the piste (hitting him knocks you over), won't wear a helmet because it ruins the hair, or his back has gone (find his Deep Heat).
- **Lycra Lee** turns up in a speed suit, cutting everyone up.
- **Alistair** is banned from the resort and nicking people's chips.
- **Banter Bob** is slagging off Leeds United at the side of the piste. Ignoring him costs the most anger; putting him right calms Andy the most.
- **The Club Chairman** rings Andy's mobile. On holiday. Snowplough to a dead stop to take the call.

Other things:

- **Cold** creeps up all day. When it's full Andy's anger rises. Ski through a **hot chocolate stand** to warm up (and calm down).
- **Slalom gates**: ski between the flags for points; several in a row multiply.
- **Big air** off ramps and moguls scores points too.
- Beat the run's **par time** for a time bonus.
- Each day is longer, steeper and busier: the Nursery Slope (green), Le Grand Faff (blue), Col du Grumble (red), the Widowmaker (black), KFT's Shortcut (off-piste) and the Last Run to the Bar. Half of Andy's anger carries over to the next day. Finish the week and you can go round again, harder.

**Controls:** LEFT/RIGHT (or A/D) to steer. DOWN (S) to tuck and go faster, UP (W) to snowplough and slow down. SPACE (or E) to jump, and to sort out a scrape when you're next to it. P pauses, M mutes. On a phone or tablet, an on-screen joystick and ACT button appear when you touch the screen.

## Run it

From this folder:

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. `npm run build` makes a static site in `dist/`.

```bash
npm test
```

```bash
npm run smoke
```

`npm test` runs the unit tests, including a bot skiing the whole week on several seeds. `npm run smoke` drives the real page in headless Chromium and saves screenshots to `smoke-output/` (it needs Playwright). Add `?seed=123` to the URL to get the same mountain every time.

## Share it

```bash
npm run package
```

This makes **one file**, `release/AngryAndyOnTheSlopes.html`, with the game, the pictures and the fonts inside it. People double-click it to play in their browser. High scores are saved in each person's own browser.

## Changing things

Everything you'd want to tweak is in `src/data/`:

| File | What it holds |
|---|---|
| `scrapes.json` | Every scrape: who, what kind (help, fetch, chase, snowball, wild, lift, phone), what they shout, what Andy says, how often it happens. |
| `catchphrases.json` | Andy's catchphrases, grumbles and crash lines, what people say when he flattens them, big-air shouts, the Leeds banter and Andy's replies, the Chairman, the après-ski lines and each run's intro. |
| `tuning.json` | Ski physics (speeds, turning, braking, jumps), anger and calm amounts, points, and the six days: run names, lengths, widths, how busy they are, par times and the bar at the bottom. |
| `characters.json` | The cast and the looks used to draw the placeholder art. |

Art: see [ASSETS.md](ASSETS.md). All pictures are generated by `tools/make-placeholder-art.mjs` (`npm run art`).

## Code layout

- `src/main.ts`: boot and the game loop.
- `src/game/`: rules, as plain TypeScript with no DOM. `game.ts` (Andy's skiing, crashes, scrapes, scoring), `world.ts` (the piste and everything on it, built in slices as you go), `meters.ts`, `lines.ts`.
- `src/render/renderer.ts`: draws the mountain, the HUD, the scrapes panel and the screens on one canvas.
- `src/core/`: assets loader, keyboard and touch input, synthesised sound effects.
