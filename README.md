# LIMINAL — SIH 2026, problem statement 26177

A leaderless drone swarm that searches collapsed buildings for the people inside.
This is the project's website, built as a story you scroll through, in five acts.

## Open it
- **`index.html` is the whole site in one file.** Double-click it and it opens in the browser, offline, with no terminal and no install. Chrome or Edge work best.
- **Online:** turn on GitHub Pages (Settings, then Pages, then "Deploy from a branch", branch `main`, folder `/ (root)`) and open `https://yokai47.github.io/liminal-sih26177/`.
- **`source/`** is the code `index.html` is built from, file by file. You don't need it to view the site; it's there to read.

## The five acts
- **Act 1**, the hook and the idea. The first screen is a live school of drones that assembles the name while the page loads (your cursor is a predator). Then someone is tapping under the rubble: find them with a torch; why 72 hours matter; what rescuers carry today and where each tool stops; one drone, then the swarm, map the building until β₀ counts the unexplored pockets down to zero; the person found at first light. Then **not just one building**: six live disaster-zone scenes, each from a real event, where the swarm works on its own (an earthquake city block, the Silkyara tunnel, the Wayanad debris flow, the 2018 Kerala floods, a forest, the Tham Luang cave). It ends with the five acts.
- **Act 2**, "Fly the first drone": you are the drone. A collapsed floor with four people inside. Watch the autonomy fly it, or take the sticks.
- **Act 3**, "Open the drone up": inside one drone. A guided tour of Layer 1 in 27 steps (or a 10-step quick tour for judges): the drone taken apart, the two brains, why a quad cannot fly itself, the flight controller opened down to its chips, the accelerometer, gyroscope, barometer and magnetometer working inside their chips, vibration and the notch filter, sensor fusion and the Kalman gain, optical flow and observability, cascaded PID, LiDAR, tilt-to-3-D and stop-and-scan, global shutter, calibration and PnP, SLAM and loop closure, OctoMap and log-odds, YOLO and PointPainting, depth completion, frontier exploration, MAVROS2 and ENU/NED, the full cycle, failsafes and the outdoor extension. Every step has a live simulation with sliders and readouts.
- **Act 4**, "Watch the swarm work": the swarm at work, on its own. Four missions in 3-D: a city block after an earthquake, a flooded village, a forest and a flooded cave. Each is simulated in full first, then played back as a film with a director camera, chapters, captions, six lenses (world, the swarm's map, the mesh, the physics, UV marks, proof), live concept cards that link to the matching Act 5 page, a drone's-eye inset, the tethered drone, and a handover report. Pause, scrub, switch lenses or grab the camera; "Play all four" runs them back to back. Every visit is a new seed.
- **Act 5**, "Open the swarm lab": inside the swarm. Layer 2 taken apart in 14 live simulations in six parts: boids, Vicsek criticality and the name, critical slowing down, symmetry breaking with a UGV, Turing patterns, phase changes as mission commands, stigmergy, CRDT map merging, topology with persistence, the air pocket (β₂ on the voxel map), Koopman prediction, reservoir computing, the FPGA timing, and the demonstration rig; then six things to remember. Only the simulation on screen runs.

## Controls worth knowing
- **Contents** (top of the screen, or "See what's inside" on the first screen) lists every chapter of Act 1, the six disaster zones, every page of the swarm lab and all five acts, and jumps anywhere.
- Press Enter on the first screen and the page goes full screen (browsers only allow full screen after a click). The button next to Sound, or the F key, toggles it.
- Acts 2 to 5 open on top of the story, in the same page. **Back to the story** in each act returns to where you were in Act 1.
- In Act 2, **END** (top bar) stops the run at any point and shows the mission report.
- In Act 3, move with **Next** (bottom right), **Back**, the arrow keys, one scroll-wheel notch per step, a swipe on phones, or **All steps** (top).
- Music is generative and synthesised in the browser. It is on if you entered with sound, and each act has its own switch.
- Shortcuts: add `#act2`, `#act3` or `#act4` to the address and that act opens straight after the first screen; `#act5` (or `#lab`) opens the swarm lab, `#lab-vicsek` (or any lab page id) one simulation in it, `#contents` opens the contents.

## How Act 1 is made
- **The two sets are path-traced, then baked.** A close-up of the void (tiles, papers, a fallen chair, a pipe, crushed concrete, a phone) and a clay maquette of the whole building were modelled procedurally in Blender (Python) and lit in Cycles, twice each: moonlight and dawn. The full light transport is baked into lightmaps, so the browser shows what the path tracer computed. The scroll blends night into dawn.
- **The torch is real light.** Your cursor aims a spotlight with soft shadow maps; it borrows the bake's ambient occlusion and grain so what it lights has corners and texture.
- **The mapping is real.** On load, drones explore the actual maquette geometry with ray casts (three-mesh-bvh): free, occupied and unknown cells, nearest unclaimed frontier, BFS paths. One drone; eight that share what they've searched; eight that don't. Every number on the page (area, moves, the race, β₀) comes from those runs.
- **β₀ counts pockets that are really there.** Each unexplored pocket is tracked from move to move, so it keeps its number until it is searched. A pocket that lasts only a few moves is a LiDAR shadow behind a doorframe, not a space, so it isn't counted: the persistence rule from persistent homology.
- **The person is only ever seen in thermal.** A hidden body is rendered into a heat buffer, blurred, and mapped through a thermal palette, partly hidden by the rubble.
- **All sound is synthesised** in WebAudio: the knocking (placed in 3-D, so headphones tell you the direction), a night-to-dawn bed, rotor hum, dawn birds.
- Accessibility: the story is real text in the page; "Show me where" skips the torch puzzle; reduced motion turns off the lens effects and parallax; without WebGL the text reads over a still of the model.
- Performance: Draco-compressed geometry, the 3-D scene pauses when a full-screen chapter covers it, and the page lowers its own resolution, then its shadows and lens blur, if a device struggles.

## How Act 3 is made
- **The drone is the team's own build**, modelled in Blender with Python: 580 mm X frame (16/14 mm carbon tubes between printed PETG-CF plates, TPU legs, printed guards), Tarot 4006 620KV with 12x3.8 props, Tekko32 F4 4-in-1, CUAV V6X on dampers, Raspberry Pi 5 + active cooler + AI HAT+ (Hailo-8), the 4S 5200 mAh pack on top, and the RPLidar A1M8 underneath in a cradle tilted by an OT5325M servo. Motors, props, electronics and sensors are at their datasheet dimensions; the frame and printed parts are modelled to fit them. Models are meshopt-compressed (2 MB together).
- **The flight controller layout is simplified** to the Pixhawk standard (FMU board, isolated and heated IMU module, base board); the chips are the V6X's real ones.
- **19 canvas simulations** share one small kit (`act3/js/simkit.js`): one palette, crisp canvases, sliders, readouts. Four are ports of the team's Layer 1 simulations (vibration and notch filter, sensor fusion, frontier exploration, GPS-optional handover). Only the open step runs; the rest are paused.
- Charts labelled "illustrative" show behaviour, not measured data.

## How Act 4 is made
- **Simulate first, then film.** Each mission's swarm is simulated deterministically to the end before anything plays, then the recording is played back with a director camera. Scrubbing and lens changes read the recording, so they're instant, and the film can never stall mid-mission.
- **The worlds are built in code** from a seed (streets and collapsed blocks, flood water and roofs, a forest canopy, cave passages and sumps), with a small set of props modelled in Blender with Python (`act4/assets/props.glb`).
- **The concept cards are live.** When an idea from Act 5 is doing work in the film (Vicsek order, symmetry breaking, Turing spacing, stigmergy, CRDT merging, β₀ and β₂, Koopman forecasting and the rest of the lab's 12), its card draws from the running mission at that moment and links to the matching lab page.

## Files in `source/`
- `index.html`, `act1/` — Act 1 (`main.js`, `act1.css`, `assets/`; `lab/`: the swarm lab controller `lab.js`, the simulation kit `simkit.js`, the gate swarm `swarm.js`, the music `music.js` and the 14 simulations in `lab/sims/`; `zones/`: the six disaster-zone scenes)
- `common/` — shared: `sim.js` (exploration), `sound.js`, `fluid.js` (liquid cursor field), `gate.js`, `cursor.js`, `base.css`
- `act2/` — Act 2 (see `act2/CREDITS.txt`)
- `act3/` — Act 3 (`js/act3.js` story and scene, `js/steps.js` all the words, `js/mems.js` the four sensor demos, `js/sims/`, `assets/drone.glb` and `assets/fc.glb`)
- `act4/` — Act 4 (`js/act4.js`; `js/sim/` the swarm simulator and recording; `js/engine/` renderer, director, lenses; `js/missions/` one folder per mission; `js/ui/` cards, captions, report; `assets/props.glb`)
- `fonts/` — Fraunces, Geist, Geist Mono (SIL Open Font License)
- `vendor/draco/` — Draco decoder (Apache 2.0)

`index.html` is `source/` bundled into one file with esbuild, with every model, texture and font packed inside. To run `source/` on its own, serve it (browsers block module imports from `file://`): `cd source`, then `python3 -m http.server 8000`, then open `http://localhost:8000/`. In that form three.js and three-mesh-bvh load from jsDelivr.
