/**
 * Macrion — entry point. OWNED BY LEAD. Builders edit their own module, not this.
 *
 * Module order matters:
 *   terrain first  — sky/shadows fit their frusta to it, `ground:true` shots sample heightAt
 *   world next     — sky, character
 *   systems next   — game state, player, cinematics, audio, hud
 *   devcam last    — debug camera applies after everything else has updated
 */
import { Engine } from './core/engine.js';
import { createSky } from './world/sky.js';
import { createTerrain } from './world/terrain.js';
import { createPost } from './render/post.js';
import { createCharacter } from './entities/character.js';
import { createGame } from './game/game.js';
import { createController } from './player/controller.js';
import { createCutscene } from './cinematics/cutscene.js';
import { createAudio } from './audio/audio.js';
import { createHUD } from './ui/hud.js';
import { createDevCam } from './core/devcam.js';

const engine = new Engine();

engine.registerModule(createTerrain(engine.ctx));
engine.registerModule(createSky(engine.ctx));
const character = engine.registerModule(createCharacter(engine.ctx));

const post = createPost(engine.ctx);
if (post) {
  engine.registerModule(post);
  if (post.composer) engine.composer = post.composer;
}

// Systems can reach each other through the shared registry rather than imports,
// so a builder can depend on a sibling without editing this file.
engine.systems = { character };
engine.systems.game = engine.registerModule(createGame(engine.ctx));
engine.systems.player = engine.registerModule(createController(engine.ctx));
engine.systems.cutscene = engine.registerModule(createCutscene(engine.ctx));
engine.systems.audio = engine.registerModule(createAudio(engine.ctx));
engine.systems.hud = engine.registerModule(createHUD(engine.ctx));

engine.setShot('vista');
const contract = engine.installContract('macrion.phase1');
contract.systems = engine.systems;

// Dev camera is inert until the user gives input, so it cannot perturb a capture.
const devcam = engine.registerModule(createDevCam(engine.ctx));

// Captures hide the HUD; hide all in-world chrome with it.
const baseHud = contract.hud;
contract.hud = (v) => {
  baseHud(v);
  devcam.setChrome(v);
  engine.systems.hud?.setVisible?.(v);
};

engine.start();
