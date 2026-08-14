# Drop-in characters (Mixamo, GLB, FBX)

Put character files in **this folder**, then load one with a query parameter:

    http://localhost:5188/?character=MyGuy.fbx

To make it stick across reloads, run this once in the browser console:

    localStorage.setItem('macrion.character', 'MyGuy.fbx')
    localStorage.removeItem('macrion.character')   // back to the procedural Oz

Both `.fbx` and `.glb` / `.gltf` work.

## Getting a character from Mixamo

1. Go to mixamo.com and sign in (free Adobe account).
2. Pick a character, then **Download** → Format **FBX Binary**, Pose **T-pose**.
3. Save it here as e.g. `MyGuy.fbx`.

## Adding animations

Two options.

**A. Baked in.** On Mixamo, choose your character, pick an animation, download
with *Skin: With Skin*. That single file contains both mesh and clip.

**B. Separate clip files** — better, since you can add as many as you like.
Download each animation with *Skin: Without Skin* and name them after the base
file with an `@pose` suffix:

    MyGuy.fbx           <- the character
    MyGuy@idle.fbx
    MyGuy@walk.fbx
    MyGuy@run.fbx
    MyGuy@attack.fbx
    MyGuy@stagger.fbx
    MyGuy@die.fbx

The loader picks these up automatically. Recognised poses: `idle`, `walk`, `run`,
`attack`, `stagger`, `die`.

Clip names are also matched loosely, so a clip called "Fast Run" or
"Standing Melee Attack" is classified correctly even without the `@` suffix.

## Notes

- **Scale is handled for you.** Mixamo FBX exports are in centimetres; the loader
  measures the rig and normalises it to ~1.75 m, then sits the feet on the ground.
- **Materials are converted** to physically-based ones so the character responds to
  Macrion's sky lighting, tonemapping and shadows like everything else.
- Press **B** in game for the sandbox panel — volume, animation buttons, music
  states, and cutscene triggers. It shows which clips were actually found.
- If nothing loads, open the browser console; the loader logs what it found and
  why it failed.

## Licensing — read this

Mixamo assets are free to use under Adobe's terms, **but they are not
procedurally generated and they are not ours.** Macrion's README and PLAYBOOK
state that everything in the project is generated from scratch with no external
assets. That claim is about the *procedural* character (`src/entities/character.js`)
and the rest of the engine, which remains true.

**Do not commit downloaded character files to this repository** — this folder is
gitignored for that reason. Use them locally for testing and iteration. If a
Mixamo character ever ships in a build, the licensing and the "no external
assets" claim both need revisiting first.
