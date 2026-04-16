// ── VISUALIZER REGISTRY ──
// Central hub: imports all render functions, exposes RENDER_MAP, TRAIL_MODES, resetState

export { renderLuminousDrift } from "./dustParticles.js";
export { renderSilkRibbons }   from "./harmonicWaves.js";
export { renderHyperPolyhedra } from "./hyperPolyhedra.js";
export { renderCosmicFlow }    from "./cosmicFlow.js";
export { renderDeepOcean }     from "./deepOcean.js";
export { renderPlasmaNebula }  from "./plasmaDuo.js";
export { renderRainDrops }     from "./rainDrops.js";
export { renderAmbientSpectrum } from "./ambientSpectrum.js";
export { renderNakhwaFire }    from "./nakhwaFire.js";
export { renderRingSpectrum }       from "./ringSpectrum.js";
export { renderSongTitle }          from "./songTitle.js";
export { renderPrismaticCollision } from "./prismaticCollision.js";
export { renderBokehSparkle }       from "./bokehSparkle.js";

import { renderLuminousDrift }      from "./dustParticles.js";
import { renderSilkRibbons }        from "./harmonicWaves.js";
import { renderHyperPolyhedra }     from "./hyperPolyhedra.js";
import { renderCosmicFlow }         from "./cosmicFlow.js";
import { renderDeepOcean }          from "./deepOcean.js";
import { renderPlasmaNebula }       from "./plasmaDuo.js";
import { renderRainDrops }          from "./rainDrops.js";
import { renderAmbientSpectrum }    from "./ambientSpectrum.js";
import { renderNakhwaFire }         from "./nakhwaFire.js";
import { renderRingSpectrum }       from "./ringSpectrum.js";
import { renderPrismaticCollision } from "./prismaticCollision.js";
import { renderBokehSparkle }       from "./bokehSparkle.js";

import { resetDust }                from "./dustParticles.js";
import { resetHarmonicWaves }       from "./harmonicWaves.js";
import { resetPolyhedra }           from "./hyperPolyhedra.js";
import { resetCosmicFlow }          from "./cosmicFlow.js";
import { resetPlasma }              from "./plasmaDuo.js";
import { resetRainDrops }           from "./rainDrops.js";
import { resetAmbientSpectrum }     from "./ambientSpectrum.js";
import { resetNakhwa }              from "./nakhwaFire.js";
import { resetRingSpectrum }        from "./ringSpectrum.js";
import { resetPrismaticCollision }  from "./prismaticCollision.js";
import { resetBokehSparkle }        from "./bokehSparkle.js";

export const RENDER_MAP = {
  ethereal_breath:       renderLuminousDrift,
  liquid_aurora:         renderSilkRibbons,
  sacred_geometry:       renderHyperPolyhedra,
  cosmic_flow:           renderCosmicFlow,
  deep_ocean:            renderDeepOcean,
  nebula_consciousness:  renderPlasmaNebula,
  rain_drops:            renderRainDrops,
  audio_spectrum:        renderAmbientSpectrum,
  nakhwa_fire:           renderNakhwaFire,
  ring_spectrum:         renderRingSpectrum,
  prismatic_collision:   renderPrismaticCollision,
  bokeh_sparkle:         renderBokehSparkle,
};

export const TRAIL_MODES = new Set(["cosmic_flow"]);

export function resetState() {
  resetDust();
  resetHarmonicWaves();
  resetPolyhedra();
  resetCosmicFlow();
  resetPlasma();
  resetRainDrops();
  resetAmbientSpectrum();
  resetNakhwa();
  resetRingSpectrum();
  resetPrismaticCollision();
  resetBokehSparkle();
}
